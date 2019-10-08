const http = require('http')
const httpProxy = require('http-proxy')
const zlib = require('zlib')
const request = require('request')

const proxy = httpProxy.createProxyServer({})
const HOOK_JS = `
XMLHttpRequest.prototype._open = XMLHttpRequest.prototype.open
XMLHttpRequest.prototype.open = function(method, url, async, user, password) {
	const u = new URL(url, location.href)
	if (u.hostname === 'music.163.com') {
		u.hostname = location.hostname
	}
	this._open(method, u.href, async, user, password)
}
document.addEventListener('click', function(e) {
	e.preventDefault()
	let el = e.target
	while (el && el.tagName !== 'A') {
		el = el.parentElement
	}
	if (el && el.tagName === 'A' && el.getAttribute('href').startsWith('/')) {
		e.preventDefault()
		top.location.href = location.protocol + '//' + location.host + el.getAttribute('href')
	}
})
`
proxy.on('proxyReq', (proxyReq, req, res, options) => {
	proxyReq.setHeader('X-Real-IP', '111.25.24.23')
})
proxy.on('proxyRes', (proxyRes, req, res, options) => {
	if (proxyRes.headers['location']) {
		let u = proxyRes.headers['location']
		if (u.startsWith('//')) {
			u = 'https:' + u
		}
		return request(u).pipe(res)
	}
	const headers = proxyRes.headers
	const type = proxyRes.headers['content-type']
	if (proxyRes.headers['content-encoding'] === 'gzip') {
		proxyRes = proxyRes.pipe(zlib.createGunzip())
	}
	if (req.url.startsWith('/weapi/song/enhance/player/url/v1')) {
		// res.writeHead(200, headers)
		let body = []
		proxyRes
			.on('data', chunk => {
				body.push(chunk)
			})
			.on('end', () => {
				let json = Buffer.concat(body).toString()
				const data = JSON.parse(json)
				const url = data.data[0].url
				if (url.includes('m10')) {
					// dns cache pollution for dns servers outside of China
					data.data[0].url = url.replace('m10', 'm11')
				}
				if (url.includes('m801')) {
					// because m801 will block user by Referer
					data.data[0].url = url.replace('m801', 'm701')
				}
				res.write(JSON.stringify(data))
				res.end()
			})
	} else if (type && type.includes('html')) {
		res.writeHead(200, headers)
		let body = []
		proxyRes
			.on('data', chunk => {
				body.push(chunk)
			})
			.on('end', () => {
				let html = Buffer.concat(body).toString()
				html = html.replace('<head>', `<head><script>${HOOK_JS}</script>`)
				zlib.gzip(html, (err, result) => {
					res.end(result)
				})
			})
	} else {
		proxyRes.pipe(res)
	}
})

const server = http.createServer(function(req, res) {
	proxy.web(req, res, {
		changeOrigin: true,
		target: 'https://music.163.com',
		selfHandleResponse: true
	})
})

server.listen(process.env.PORT || 80)
