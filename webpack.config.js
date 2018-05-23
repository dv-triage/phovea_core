/* *****************************************************************************
 * Caleydo - Visualization for Molecular Biology - http://caleydo.org
 * Copyright (c) The Caleydo Team. All rights reserved.
 * Licensed under the new BSD license, available at http://caleydo.org/license
 **************************************************************************** */

const {libraryAliases, libraryExternals, modules, entries, ignores, type, registry, vendor} = require('./.yo-rc.json')['generator-phovea'];
const resolve = require('path').resolve;
const pkg = require('./package.json');
const webpack = require('webpack');
const fs = require('fs');
const ExtractTextPlugin = require('extract-text-webpack-plugin');
const ForkTsCheckerWebpackPlugin = require('fork-ts-checker-webpack-plugin');
const buildInfo = require('./buildInfo.js');

const now = new Date();
const prefix = (n) => n < 10 ? ('0' + n) : n.toString();
const buildId = `${now.getUTCFullYear()}${prefix(now.getUTCMonth() + 1)}${prefix(now.getUTCDate())}-${prefix(now.getUTCHours())}${prefix(now.getUTCMinutes())}${prefix(now.getUTCSeconds())}`;
pkg.version = pkg.version.replace('SNAPSHOT', buildId);

const year = (new Date()).getFullYear();
const banner = '/*! ' + (pkg.title || pkg.name) + ' - v' + pkg.version + ' - ' + year + '\n' +
  (pkg.homepage ? '* ' + pkg.homepage + '\n' : '') +
  '* Copyright (c) ' + year + ' ' + pkg.author.name + ';' +
  ' Licensed ' + pkg.license + '*/\n';

const preCompilerFlags = {flags: (registry || {}).flags || {}};
const includeFeature = registry ? (extension, id) => {
  const exclude = registry.exclude || [];
  const include = registry.include || [];
  if (!exclude && !include) {
    return true;
  }
  const test = (f) => Array.isArray(f) ? extension.match(f[0]) && (id || '').match(f[1]) : extension.match(f);
  return include.every(test) && !exclude.some(test);
} : () => true;

/**
 * tests whether the given phovea module name is matching the requested file and if so convert it to an external lookup
 * depending on the loading type
 */
function testPhoveaModule(moduleName, request) {
  if (!(new RegExp('^' + moduleName + '/src.*')).test(request)) {
    return false;
  }
  const subModule = request.match(/.*\/src\/?(.*)/)[1];
  // skip empty modules = root
  const path = subModule === '' ? [moduleName] : [moduleName, subModule];
  // phovea_<name> ... phovea.name
  const rootPath = /phovea_.*/.test(moduleName) ? ['phovea', moduleName.slice(7)].concat(path.slice(1)) : path;
  return {
    root: rootPath,
    commonjs2: path,
    commonjs: path,
    amd: request + (subModule === '' ? '/main' : '')
  };
}

function testPhoveaModules(modules) {
  return (context, request, callback) => {
    for (let i = 0; i < modules.length; ++i) {
      const r = testPhoveaModule(modules[i], request);
      if (r) {
        return callback(null, r);
      }
    }
    callback();
  };
}

// use workspace registry file if available
const isWorkspaceContext = fs.existsSync(resolve(__dirname, '..', 'phovea_registry.js'));
const registryFile = isWorkspaceContext ? '../phovea_registry.js' : './phovea_registry.js';
const actMetaData = `file-loader?name=phoveaMetaData.json!${buildInfo.metaDataTmpFile(pkg)}`;
const actBuildInfoFile = `file-loader?name=buildInfo.json!${buildInfo.tmpFile()}`;

/**
 * inject the registry to be included
 * @param entry
 * @returns {*}
 */
function injectRegistry(entry) {
  const extraFiles = [registryFile, actBuildInfoFile, actMetaData];
  // build also the registry
  if (typeof entry === 'string') {
    return extraFiles.concat(entry);
  }
  const transformed = {};
  Object.keys(entry).forEach((eentry) => {
    transformed[eentry] = extraFiles.concat(entry[eentry]);
  });
  return transformed;
}

/**
 * generate a webpack configuration
 */
module.exports = (env, options) => {
  const dev = options.mode.startsWith('d');
  const prod = options.mode.startsWith('p');

  const base = {
    entries: entries,
    libs: libraryAliases,
    externals: libraryExternals,
    modules: modules,
    vendor: vendor,
    ignore: ignores,
    isProduction: isProduction,
    isDev: isDev,
    isTest: isTest
  };

  if (isTest) {
    return generateWebpack(Object.assign({}, base, {
      bundle: true
    }));
  }

  if (type.startsWith('app')) {
    base.isApp = true;
    base.bundle = true; // bundle everything together
    base.name = '[name]'; // multiple entries case
    base.commons = true; // extract commons module
  } else if (type === 'bundle') {
    base.library = true; // expose as library
    base.moduleBundle = true; // expose as library 'phovea'
    base.name = pkg.name; // to avoid adding _bundle
    base.bundle = true;
  } else { // type === 'lib'
    base.library = true;
  }

  let base = {
    node: false, // no polyfills
    entry: injectRegistry(options.entries),
    output: {
      path: resolve(__dirname, 'build'),
      filename: (options.name || pkg.name) + '.js',
      chunkFilename: '[chunkhash].js',
      publicPath: '' // no public path = relative
    },
    resolve: {
      extensions: ['.ts', '.tsx', '.js'],
      alias: Object.assign({}, libraryAliases || {}),
      symlinks: false,
      // fallback to the directory above if they are siblings just in the workspace context
      modules: isWorkspaceContext ? [
        resolve(__dirname, '../'),
        'node_modules'
      ] : ['node_modules']
    },
    plugins: [
      // define magic constants that are replaced
      new webpack.DefinePlugin({
        'process.env.NODE_ENV': JSON.stringify(options.isProduction ? 'production' : 'development'),
        __VERSION__: JSON.stringify(pkg.version),
        __LICENSE__: JSON.stringify(pkg.license),
        __BUILD_ID__: JSON.stringify(buildId),
        __DEBUG__: options.isDev || options.isTest,
        __TEST__: options.isTest,
        __PRODUCTION__: options.isProduction,
        __APP_CONTEXT__: JSON.stringify('/')
      }),
      new ForkTsCheckerWebpackPlugin({
        checkSyntacticErrors: true
      })
      // rest depends on type
    ],
    externals: [],
    module: {
      rules: [
        {test: /\.scss$/, use: 'style-loader!css-loader!sass-loader'},
        {test: /\.css$/, use: 'style-loader!css-loader'},
        {
          test: /\.tsx?$/,
          exclude: /node_modules/,
          use: [{
              loader: 'cache-loader'
            },
            {
              loader: 'thread-loader',
              options: {
                // there should be 1 cpu for the fork-ts-checker-webpack-plugin
                workers: require('os').cpus().length - 1,
              },
            },
            {
              loader: 'ts-loader',
              options: {
                configFile: dev ? 'tsconfig_dev.json' : 'tsconfig.json',
                happyPackMode: true // IMPORTANT! use happyPackMode mode to speed-up  compilation and reduce errors reported to webpack
              }
            }
          ].slice(process.env.CI || !dev ? 2 : 0) // no optimizations for CIs and in production mode
        },
        {
          test: /phovea(_registry)?\.js$/, use: [{
            loader: 'ifdef-loader',
            options: Object.assign({include: includeFeature}, preCompilerFlags)
          }]
        },
        {test: /\.json$/, use: 'json-loader'},
        {
          test: /\.(png|jpg)$/,
          loader: 'url-loader',
          options: {
            limit: 10000 // inline <= 10kb
          }
        },
        {
          test: /\.woff(2)?(\?v=[0-9]\.[0-9]\.[0-9])?$/,
          loader: 'url-loader',
          options: {
            limit: 10000, // inline <= 10kb
            mimetype: 'application/font-woff'
          }
        },
        {
          test: /\.svg(2)?(\?v=[0-9]\.[0-9]\.[0-9])?$/,
          loader: 'url-loader',
          options: {
            limit: 10000, // inline <= 10kb
            mimetype: 'image/svg+xml'
          }
        },
        {test: /\.(ttf|eot)(\?v=[0-9]\.[0-9]\.[0-9])?$/, loader: 'file-loader'}
      ]
    },
    devServer: {
      proxy: {
        '/api/*': {
          target: 'http://localhost:9000',
          secure: false,
          ws: true
        },
        '/login': {
          target: 'http://localhost:9000',
          secure: false
        },
        '/logout': {
          target: 'http://localhost:9000',
          secure: false
        },
        '/loggedinas': {
          target: 'http://localhost:9000',
          secure: false
        }
      },
      contentBase: resolve(__dirname, 'build'),
      watchOptions: {
        aggregateTimeout: 500,
        ignored: /node_modules/
      }
    },
    watchOptions: {
      aggregateTimeout: 500,
      ignored: /node_modules/
    },
    optimization: {
      splitChunks: {
        cacheGroups: {
        }
      }
    }
  };

  if (prod) {
    base.plugins.unshift(new webpack.BannerPlugin({
      banner: banner,
      raw: true
    }));
  }

  if (options.library) {
    let libName = /phovea_.*/.test(pkg.name) ? ['phovea', pkg.name.slice(7)] : pkg.name;
    // generate a library, i.e. output the last entry element
    // create library name
    if (options.moduleBundle) {
      libName = 'phovea';
    }
    base.output.library = libName;
    base.output.libraryTarget = 'umd';
    base.output.umdNamedDefine = false; // anonymous require module
  }

  if (!options.bundle) {
    // if we don't bundle don't include external libraries and other phovea modules
    base.externals.push(...(options.externals || Object.keys(options.libs || {})));

    // ignore all phovea modules
    if (modules) {
      base.externals.push(testPhoveaModules(modules));
    }

    // ignore extra modules
    (options.ignore || []).forEach(function (d) {
      base.module.loaders.push({test: new RegExp(d), loader: 'null-loader'}); // use null loader
    });
    // ingore phovea module registry calls
    (options.modules || []).forEach(function (m) {
      base.module.loaders.push({
        test: new RegExp('.*[\\\\/]' + m + '[\\\\/]phovea_registry.js'),
        loader: 'null-loader'
      }); // use null loader
    });
  }
  if (!options.bundle || options.isApp) {
    // extract the included css file to own file
    const p = new ExtractTextPlugin({
      filename: (options.isApp || options.moduleBundle ? 'style' : pkg.name) + '.css',
      allChunks: true // there seems to be a bug in dynamically loaded chunk styles are not loaded, workaround: extract all styles from all chunks
    });
    base.plugins.push(p);
    base.module.rules[0] = {
      test: /\.scss$/,
      loader: p.extract(['css-loader', 'sass-loader'])
    };
  }
  if (options.isApp) {
    // create manifest
    // base.plugins.push(new webpack.optimize.AppCachePlugin());
  }
  if (options.commons) {
    // build a commons plugin
    base.optimization.splitChunks.cacheGroups.common = {
      name: "common",
      chunks: "initial",
      minChunks: 2
    };
  }
  if (vendor) {
    (Array.isArray(vendor) ? vendor : [vendor]).forEach((reg, i) => {
      base.optimization.splitChunks.cacheGroups['vendor' + i] = {
        async: true,
        test: reg,
      };
    });
  }
  return base;
}
