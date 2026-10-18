const http = require('http');

const server = http.createServer((req, res) => {
    console.log(req.method, req.url);
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end('Halo dari server Node.js pertama saya');
});

server.listen(3000, () => {
    console.log('Server berjalan di http://localhost:3000');
});