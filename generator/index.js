const vm = require('vm');
const path = require('path');
const globby = require('globby');
const sander = require('sander');
const camelcase = require('camelcase');
const uppercaseFirst = require('upper-case-first');
const babel = require('babel-core');
const React = require('react');
const ReactDOM = require('react-dom/server');

const cssCompiler = require('../server/lib/css-compiler');

function createCss() {
	console.log(`Generating css...`);
	return new Promise((resolve, reject) => {
		cssCompiler.build(path.join(__dirname, '../src/css', 'app.less'), (err, css) => {
			if (err) {
				return reject(err);
			}
			resolve(css);
		});
	})
	.then(css => {
		return sander.writeFile('dist/css/app.css', css);
	});
}

function createReactComponent(lazyComponentRegistry, filepath, code) {
	const name = uppercaseFirst(camelcase(path.basename(filepath, '.html')));
	const options = {
		plugins: ['transform-react-jsx']
	};
	const compCode = babel.transform(code, options).code.replace(/;?$/, '');

	const sandbox = new Proxy({
		React,
		name: undefined
	}, {
		get: function (target, name) {
			if (lazyComponentRegistry[name]) {
				return lazyComponentRegistry[name];
			}
			return target[name];
		}
	});
	vm.runInNewContext(`${name} = (props) => (${compCode})`, sandbox);

	return {
		name,
		Component: sandbox[name]
	};
}

function createReactComponents() {
	// Create component object here and add all components when created to have the reference already and
	// resolve against it during runtime
	const lazyComponentRegistry = {};
	return globby(['src/react/**/*.html'])
		.then(filepaths => {
			return Promise.all(filepaths.map(filepath => {
				return sander.readFile(filepath)
					.then(content => createReactComponent(lazyComponentRegistry, filepath, content.toString()));
			}))
			.then(components => {
				return components.reduce((all, comp) => {
					all[comp.name] = comp.Component;
					return all;
				}, lazyComponentRegistry);
			});
		});
}

function renderPages(filepaths, components) {
	return Promise.all(filepaths.map(filepath => {
		return sander.readFile(filepath)
			.then(content => {
				// Transform JSX
				const options = {
					plugins: ['transform-react-jsx']
				};
				const pageCode = '__html__ = ' + babel.transform(content.toString(), options).code;

				// Eval JSX
				const sandbox = Object.assign(
					{},
					components,
					{
						React,
						__html__: ''
					}
				);
				vm.runInNewContext(pageCode, sandbox);

				// Render HTML
				const html = '<!DOCTYPE html>' + ReactDOM.renderToStaticMarkup(sandbox.__html__);

				const dest = path.join('dist', filepath.replace(/src\/pages/, ''));
				return sander.writeFile(dest, html);
			});
	}));
}

function logError(err) {
	console.error(err);
	throw err;
}

createReactComponents()
	.then(components =>
		globby(['src/pages/**/*.html'])
			.then(filepaths => renderPages(filepaths, components))
			.then(() => console.log('Done.')))
	.then(() => createCss())
	.catch(err => logError(err));
