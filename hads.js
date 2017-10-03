'use strict';

const Promise = require('bluebird');
const fs = Promise.promisifyAll(require('fs'));
const mkdirpAsync = Promise.promisify(require('mkdirp'));
const path = require('path');
const optimist = require('optimist');
const express = require('express');
const multer = require('multer');
const bodyParser = require('body-parser');
const shortId = require('shortid');
const pkg = require('./package.json');
const Matcher = require('./lib/matcher.js');
const Renderer = require('./lib/renderer.js');
const Helpers = require('./lib/helpers.js');
const Indexer = require('./lib/indexer.js');
const aliOssStorage = require('multer-ali-oss');
const config = require('./config.json');


const args = optimist
  .usage(`\n${pkg.name} ${pkg.version}\nUsage: $0 [root dir] [options]`)
  .alias('p', 'port')
  .describe('p', 'Port number to listen on')
  .default('p', 4040)
  .alias('h', 'host')
  .describe('h', 'Host address to bind to')
  .default('h', 'localhost')
  .alias('i', 'images-dir')
  .describe('i', 'Directory to store images')
  .default('i', 'images')
  .alias('o', 'open')
  .boolean('o')
  .describe('o', 'Open default browser on start')
  .describe('help', 'Show this help')
  .argv;

if (args.help || args._.length > 1) {
  optimist.showHelp(console.log);
  process.exit();
}

// Find node_modules base path
let modulesBasePath = require.resolve('highlight.js');
modulesBasePath = modulesBasePath.substr(0, modulesBasePath.lastIndexOf('node_modules'));

const docPath = args._[0] || './';
const rootPath = path.resolve(docPath);
const imagesPath = path.join(rootPath, Helpers.sanitizePath(args.i));
const customCssFile = 'custom.css';
const customStylePath = path.join(rootPath, customCssFile);
const hasCustomCss = fs.existsSync(customStylePath);
const indexer = new Indexer(rootPath);
const renderer = new Renderer(indexer);
const app = express();

app.set('views', path.join(__dirname, '/views'));
app.set('view engine', 'pug');
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({
  extended: true
}));
app.use('/_hads/', express.static(path.join(__dirname, '/public')));
app.use('/_hads/highlight/', express.static(path.join(modulesBasePath, 'node_modules/highlight.js/styles')));
app.use('/_hads/octicons/', express.static(path.join(modulesBasePath, 'node_modules/octicons/build/font')));
app.use('/_hads/font-awesome/', express.static(path.join(modulesBasePath, 'node_modules/font-awesome')));
app.use('/_hads/ace/', express.static(path.join(modulesBasePath, 'node_modules/ace-builds/src-min/')));
app.use('/_hads/mermaid/', express.static(path.join(modulesBasePath, 'node_modules/mermaid/dist/')));
app.use('/_hads/dropzone/', express.static(path.join(modulesBasePath, 'node_modules/dropzone/dist/min/')));

if (hasCustomCss) {
  app.use(`/_hads/${customCssFile}`, express.static(customStylePath));
}

const ROOT_FILES = [
  'index.md',
  'README.md',
  'readme.md'
];
const SCRIPTS = [
  '/ace/ace.js',
  '/mermaid/mermaid.min.js',
  '/dropzone/dropzone.min.js',
  '/js/client.js'
];
const STYLESHEETS = [
  '/highlight/github.css',
  '/octicons/octicons.css',
  '/css/github.css',
  '/css/style.css',
  '/font-awesome/css/font-awesome.css'
].concat(hasCustomCss ? [`/${customCssFile}`] : []);

app.get('*', (req, res, next) => {
  let route = Helpers.extractRoute(req.path);
  console.log("---------------\nGET: " + route);
  const query = req.query || {};
  console.log("QUERY: " + JSON.stringify(query));

  let rootIndex = -1;
  let mdIndex = -1;
  const create = Helpers.hasQueryOption(query, 'create');
  let edit = Helpers.hasQueryOption(query, 'edit') || create;
  let filePath, icon, search, error, title, contentPromise;

  function renderPage() {
    if (error) {
      edit = false;
      contentPromise = Promise.resolve(renderer.renderMarkdown(error));
      icon = 'octicon-alert';
    }

    else if (search) {
      contentPromise = renderer.renderSearch(query.search);
      icon = 'octicon-search';
    }

    else if (Helpers.hasQueryOption(query, 'raw') || Matcher.isImage(filePath)) {
      return res.sendFile(filePath);
    }

    else if (Matcher.isMarkdown(filePath)) {
      contentPromise = edit ? renderer.renderRaw(filePath) : renderer.renderFile(filePath);
      icon = 'octicon-file';
    }

    else if (Matcher.isSourceCode(filePath)) {
      contentPromise = renderer.renderSourceCode(filePath, path.extname(filePath).replace('.', ''));
      icon = 'octicon-file-code';
    }

    if (!title) {
      title = search ? renderer.searchResults : path.basename(filePath);
    }

    if (contentPromise) {
      return contentPromise.then(content => {
        res.render(edit ? 'edit' : 'file', {
          title,
          route,
          icon,
          search,
          content,
          styles: STYLESHEETS,
          scripts: SCRIPTS,
          pkg
        });
      });
    }
    next();
  }

  function tryProcessFile() {
    contentPromise = null;
    filePath = path.join(rootPath, route);

    return fs.statAsync(filePath)
      .then(stat => {
        search = query.search && query.search.length > 0 ? query.search.trim() : null;

        if (stat.isDirectory() && !search && !error) {
          if (!create) {
            // Try to find a root file
            route = path.join(route, ROOT_FILES[++rootIndex]);
            return tryProcessFile();
          }
          route = '/';
          title = 'Error';
          error = `Cannot create file \`${filePath}\``;
        }

        return renderPage();
      })
      .catch(() => {
        if (create) {
          const fixedRoute = Helpers.ensureMarkdownExtension(route);
          if (fixedRoute !== route) {
            return res.redirect(fixedRoute + '?create=1');
          }
          console.log("Create new: " + filePath);

          return mkdirpAsync(path.dirname(filePath))
            .then(() => fs.writeFileAsync(filePath, ''))
            .then(() => indexer.updateIndexForFile(filePath))
            .then(tryProcessFile)
            .catch(e => {
              console.error(e);
              title = 'Error';
              error = `Cannot create file \`${filePath}\``;
              route = '/';
              return renderPage();
            });
        }


         else if (rootIndex !== -1 && rootIndex < ROOT_FILES.length - 1) {
          route = path.join(path.dirname(route), ROOT_FILES[++rootIndex]);

          return tryProcessFile();
        }



        else if (rootIndex === -1 &&
          path.basename(route) !== '' &&
          (path.extname(route) === '' || mdIndex > -1) &&
          mdIndex < Matcher.MARKDOWN_EXTENSIONS.length - 1) {
          // Maybe it's a github-style link without extension, let's try adding one
          const extension = Matcher.MARKDOWN_EXTENSIONS[++mdIndex];
          route = path.join(path.dirname(route), `${path.basename(route, path.extname(route))}.${extension}`);
          return tryProcessFile();
        }



        if (path.dirname(route) === path.sep && rootIndex === ROOT_FILES.length - 1) {
          error = '## No home page (╥﹏╥)\nDo you want to create an [index.md](/index.md?create=1) or ' +
            '[readme.md](/readme.md?create=1) file perhaps?';
        }

        else {
          const new_file = Helpers.ensureMarkdownExtension(route);
          error = `## File not found ¯\\\\\\_(◕\\_\\_◕)_/¯\n > Do you want to create [${new_file}](${new_file}?create=1)`;
        }
        title = '404 Error';
        route = '/';

        return renderPage();
      });
  }

  tryProcessFile();
});

app.post('/_hads/upload', [multer({
    storage: aliOssStorage({
    config: {
      region: config.aliOSS.region,
      accessKeyId: config.aliOSS.accessKeyId,
      accessKeySecret: config.aliOSS.accessKeySecret,
      bucket: config.aliOSS.bucket
    },
    filename: function (req, file, cb) {
      cb(null, file.fieldname + '-' + Date.now() + path.extname(file.originalname))
    }
  }),
/*
multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, imagesPath);
  },
  filename: (req, file, cb) => {
    mkdirpAsync(imagesPath).then(() => {
      cb(null, shortId.generate() + path.extname(file.originalname));
    });
  }
}),
*/
    onFileUploadStart: file => !file.mimetype.match(/^image\//),
    limits: {
      fileSize: 1024 * 1024 * 10 // 10 MB
    }
  })
  .single('file'), (req, res) => {
/*
console.log("POST /_hads/upload: " + req.file.path);
res.json(path.sep + path.relative(rootPath, req.file.path));
*/
  console.log("POST /_hads/upload: " + req.file.url);
  res.json(req.file.url);
  }
]);

app.post('*', (req, res, next) => {
  const route = Helpers.extractRoute(req.path);
  const filePath = path.join(rootPath, route);
  console.log("---------------\nPOST: " + route);

  fs.statAsync(filePath)
    .then(stat => {
      let fileContent = req.body.content;
      if (stat.isFile() && fileContent) {
        if (process.platform !== 'win32') {
          // Www-form-urlencoded data always use CRLF line endings, so this is a quick fix
          fileContent = fileContent.replace(/\r\n/g, '\n');
        }
        return fs.writeFileAsync(filePath, fileContent);
      }
    })
    .then(() => {
      console.log("Write file done:" + filePath);
      indexer.updateIndexForFile(filePath);
      console.log("Index file done");
      return renderer.renderFile(filePath);
    })
    .then(content => {

      res.render('file', {
        title: path.basename(filePath),
        route,
        icon: 'octicon-file',
        content,
        styles: STYLESHEETS,
        scripts: SCRIPTS,
        pkg
      });
    })
    .catch((err) => {
      console.log(err);

      next();
    });
});



indexer.indexFiles().then(() => {
  app.listen(args.port, args.host, () => {
    const serverUrl = `http://${args.host}:${args.port}`;
    console.log(`${pkg.name} ${pkg.version} serving at ${serverUrl} (press CTRL+C to exit)`);

    if (args.open) {
      require('open')(serverUrl);
    }
  });
});

exports = app;
