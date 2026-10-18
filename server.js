// ---------- pemanggilan module dan konstanta ----------
const http = require('http');
const fs = require('fs/promises');
const path = require('path');
const { buildSchema, graphql } = require('graphql');

const PORT = 3000;
const DATA_FILE = path.join(__dirname, 'data', 'destinations.json');
const REGION_FILE = path.join(__dirname, 'data', 'regions.json');

// ---------- helper respons ----------
function kirimJSON(res, statusCode, data) {
    const body = JSON.stringify(data);
    res.writeHead(statusCode, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(body)
    });
    res.end(body);
}

function kirimError(res, statusCode, pesan) {
    kirimJSON(res, statusCode, { error: pesan });
}

// ---------- helper data ----------
async function bacaData() {
    const isi = await fs.readFile(DATA_FILE, 'utf8');
    return JSON.parse(isi);
}

async function simpanData(data) {
    await fs.writeFile(DATA_FILE, JSON.stringify(data, null, 2));
}

async function bacaRegions() {
    const isi = await fs.readFile(REGION_FILE, 'utf8');
    return JSON.parse(isi);
}

// ---------- helper request ----------
function buatError(statusCode, pesan) {
    const err = new Error(pesan);
    err.statusCode = statusCode;
    return err;
}

function bacaBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', (chunk) => {
            body += chunk;
        });
        req.on('end', () => {
            if (body === '') return resolve(null);
            try {
                resolve(JSON.parse(body));
            } catch (err) {
                reject(buatError(400, 'Body request bukan JSON yang valid'));
            }
        });
        req.on('error', reject);
    });
}

// ---------- logika destinasi ----------
async function periksaDestinasi(input) {
    if (input === null || typeof input !== 'object' || Array.isArray(input)) {
        throw buatError(400, 'Data destinasi harus berupa object');
    }
    const kurang = ['name', 'category'].filter(
        (field) => typeof input[field] !== 'string' || input[field].trim() === ''
    );
    if (kurang.length > 0) {
        throw buatError(400, `Field wajib belum diisi: ${kurang.join(', ')}`);
    }
    const regionId = Number(input.regionId);
    const regions = await bacaRegions();
    if (!regions.some((r) => r.id === regionId)) {
        throw buatError(400, 'regionId wajib diisi dengan id region yang tersedia');
    }
    return {
        name: input.name.trim(),
        category: input.category.trim(),
        regionId: regionId
    };
}

async function buatDestinasi(input) {
    const bersih = await periksaDestinasi(input);
    const data = await bacaData();
    const idBaru = data.length === 0 ? 1 : Math.max(...data.map((d) => d.id)) + 1;
    const item = { id: idBaru, ...bersih };
    data.push(item);
    await simpanData(data);
    return item;
}

// ---------- handler ----------
async function daftarDestinasi(req, res, url) {
    let data = await bacaData();
    const kategori = url.searchParams.get('category');
    if (kategori) {
        data = data.filter((item) => item.category === kategori);
    }
    kirimJSON(res, 200, data);
}

async function detailDestinasi(req, res, id) {
    const data = await bacaData();
    const item = data.find((d) => d.id === id);
    if (!item) {
        return kirimError(res, 404, `Destinasi dengan id ${id} tidak ditemukan`);
    }
    kirimJSON(res, 200, item);
}

async function tambahDestinasi(req, res) {
    const input = await bacaBody(req);
    const item = await buatDestinasi(input);
    res.setHeader('Location', `/destinations/${item.id}`);
    kirimJSON(res, 201, item);
}

async function ubahDestinasi(req, res, id) {
    const input = await bacaBody(req);
    const data = await bacaData();
    const index = data.findIndex((d) => d.id === id);
    if (index === -1) {
        return kirimError(res, 404, `Destinasi dengan id ${id} tidak ditemukan`);
    }
    const bersih = await periksaDestinasi(input);
    data[index] = { id: id, ...bersih };
    await simpanData(data);
    kirimJSON(res, 200, data[index]);
}

async function hapusDestinasi(req, res, id) {
    const data = await bacaData();
    const index = data.findIndex((d) => d.id === id);
    if (index === -1) {
        return kirimError(res, 404, `Destinasi dengan id ${id} tidak ditemukan`);
    }
    data.splice(index, 1);
    await simpanData(data);
    res.writeHead(204);
    res.end();
}

async function tanganiRegions(req, res, segmen) {
    if (req.method !== 'GET') {
        res.setHeader('Allow', 'GET');
        return kirimError(res, 405, `Method ${req.method} tidak didukung pada endpoint ini`);
    }
    const regions = await bacaRegions();
    if (segmen.length === 1) {
        return kirimJSON(res, 200, regions);
    }
    const item = regions.find((r) => r.id === Number(segmen[1]));
    if (!item) {
        return kirimError(res, 404, `Region dengan id ${segmen[1]} tidak ditemukan`);
    }
    kirimJSON(res, 200, item);
}

// ---------- graphql: schema ----------
const schema = buildSchema(`
  type Destination {
    id: ID!
    name: String!
    category: String
    region: Region
  }

  type Region {
    id: ID!
    name: String!
    weather: Weather
  }

  type Weather {
    temperature: Float
    windSpeed: Float
    time: String
  }

  type Query {
    destinations: [Destination]
    destination(id: ID!): Destination
  }

  type Mutation {
    createDestination(
      name: String!
      category: String!
      regionId: ID!
    ): Destination
  }
`);

// ---------- fungsi pelengkap ----------
async function ambilCuaca(region) {
    const url = 'https://api.open-meteo.com/v1/forecast'
        + `?latitude=${region.latitude}&longitude=${region.longitude}`
        + '&current=temperature_2m,wind_speed_10m'
        + '&timezone=Asia/Makassar';

    console.log(`  memanggil Open-Meteo untuk: ${region.name}`);
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) {
        throw new Error(`Open-Meteo menjawab dengan status ${res.status}`);
    }
    const hasil = await res.json();
    return {
        temperature: hasil.current.temperature_2m,
        windSpeed: hasil.current.wind_speed_10m,
        time: hasil.current.time
    };
}

function lengkapiRegion(region) {
    return {
        ...region,
        weather: () => ambilCuaca(region)
    };
}

function lengkapiDestinasi(item) {
    return {
        ...item,
        region: async () => {
            console.log(`  resolver region dijalankan untuk: ${item.name}`);
            const regions = await bacaRegions();
            const region = regions.find((r) => r.id === item.regionId);
            return region ? lengkapiRegion(region) : null;
        }
    };
}

// ---------- graphql: resolver ----------
const resolver = {};

resolver.destinations = async () => {
    const data = await bacaData();
    return data.map(lengkapiDestinasi);
};

resolver.destination = async (args) => {
    const data = await bacaData();
    const item = data.find((d) => d.id === Number(args.id));
    if (!item) {
        throw new Error(`Destinasi dengan id ${args.id} tidak ditemukan`);
    }
    return lengkapiDestinasi(item);
};

resolver.createDestination = async (args) => {
    const item = await buatDestinasi(args);
    return lengkapiDestinasi(item);
};

// ---------- graphql: handler ----------
async function tanganiGraphQL(req, res) {
    if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        return kirimError(res, 405, 'Endpoint /graphql hanya menerima method POST');
    }
    const body = await bacaBody(req);
    if (body === null || typeof body.query !== 'string') {
        return kirimError(res, 400, 'Body harus berupa JSON yang memiliki field query');
    }
    const hasil = await graphql({
        schema: schema,
        source: body.query,
        rootValue: resolver
    });
    kirimJSON(res, 200, hasil);
}

// ---------- router ----------
async function router(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const segmen = url.pathname.split('/').filter(Boolean);

    if (segmen[0] === 'graphql' && segmen.length === 1) {
        return tanganiGraphQL(req, res);
    }
    if (segmen[0] === 'regions' && segmen.length <= 2) {
        return tanganiRegions(req, res, segmen);
    }
    if (segmen[0] !== 'destinations' || segmen.length > 2) {
        return kirimError(res, 404, 'Endpoint tidak ditemukan');
    }

    if (segmen.length === 1) {
        if (req.method === 'GET') return daftarDestinasi(req, res, url);
        if (req.method === 'POST') return tambahDestinasi(req, res);
        res.setHeader('Allow', 'GET, POST');
        return kirimError(res, 405, `Method ${req.method} tidak didukung pada endpoint ini`);
    }

    // Endpoint item: /destinations/:id
    const id = Number(segmen[1]);
    if (!Number.isInteger(id) || id < 1) {
        return kirimError(res, 400, 'id harus berupa bilangan bulat positif');
    }

    if (req.method === 'GET') return detailDestinasi(req, res, id);
    if (req.method === 'PUT') return ubahDestinasi(req, res, id);
    if (req.method === 'DELETE') return hapusDestinasi(req, res, id);
    res.setHeader('Allow', 'GET, PUT, DELETE');
    return kirimError(res, 405, `Method ${req.method} tidak didukung pada endpoint ini`);
}

// ---------- server ----------
const server = http.createServer(async (req, res) => {
    console.log(`${new Date().toISOString()} ${req.method} ${req.url}`);
    try {
        await router(req, res);
    } catch (err) {
        if (err.statusCode) {
            return kirimError(res, err.statusCode, err.message);
        }
        console.error(err);
        kirimError(res, 500, 'Terjadi kesalahan pada server');
    }
});

server.listen(PORT, () => {
    console.log(`Server berjalan di http://localhost:${PORT}`);
});