const express = require('express');
const fetch = require('node-fetch');
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');
const config = require('./setting.js');
const fs = require('fs').promises;

const app = express();
const PORT = config.PORT || 3000;

// In-memory storage untuk order (akan hilang di Vercel, gunakan database untuk production)
const orders = new Map();

app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(__dirname)); // sajikan file statis dari root

//━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 📦 FUNGSI PEMBAYARAN PAKASIR (sama seperti sebelumnya)
//━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
async function createQRISPayment(orderId, amount) {
    try {
        const response = await fetch('https://app.pakasir.com/api/transactioncreate/qris', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
            body: JSON.stringify({
                project: config.PAKASIR_PROJECT,
                api_key: config.PAKASIR_API_KEY,
                order_id: orderId,
                amount: amount
            })
        });
        const data = await response.json();
        if (!data.success && !data.payment) return null;
        const payment = data.payment || data;
        return {
            success: true,
            payment_number: payment.payment_number || payment.code || '',
            qris_string: payment.payment_number || payment.qris_string || '',
            raw: data
        };
    } catch (error) {
        return null;
    }
}

async function checkPaymentStatus(orderId) {
    try {
        const detailUrl = `https://app.pakasir.com/api/transactiondetail?project=${encodeURIComponent(config.PAKASIR_PROJECT)}&amount=0&order_id=${encodeURIComponent(orderId)}&api_key=${encodeURIComponent(config.PAKASIR_API_KEY)}`;
        const response = await fetch(detailUrl);
        const data = await response.json();
        const transaction = data.transaction || data || {};
        let status = transaction.status || '';
        if (typeof status === 'string') {
            status = status.toLowerCase();
            if (status === 'success') status = 'paid';
            if (status === 'settled') status = 'paid';
        }
        return { success: true, status, transaction, raw: data };
    } catch (error) {
        return null;
    }
}

async function processPayment(orderId, amount) {
    const qrData = await createQRISPayment(orderId, amount);
    if (!qrData) throw new Error('Gagal membuat pembayaran QRIS');
    return qrData;
}

//━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 🖥️ FUNGSI CREATE PTERODACTYL SERVER (sama seperti sebelumnya)
//━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
async function createPterodactylServer(userId, panelType, username, serverName = null) {
    try {
        let ram, disk, cpu;
        if (panelType === 'unli' || panelType === 'unlimited') {
            ram = disk = cpu = 0;
        } else {
            const map = {
                '1gb': [1024, 1024, 40], '2gb': [2048, 2048, 60], '3gb': [3072, 3072, 80],
                '4gb': [4096, 4096, 100], '5gb': [5120, 5120, 120], '6gb': [6144, 6144, 140],
                '7gb': [7168, 7168, 160], '8gb': [8192, 8192, 180], '9gb': [9216, 9216, 200],
                '10gb': [10240, 10240, 220]
            };
            [ram, disk, cpu] = map[panelType] || [1024, 1024, 40];
        }

        const serverCount = 1;
        const safeServerName = serverName || (panelType === 'unli' || panelType === 'unlimited'
            ? `${capitalize(username)} UNLI Server #${serverCount}`
            : `${capitalize(username)} ${panelType.toUpperCase()} Server #${serverCount}`);

        const serverResponse = await fetch(`${config.DOMAIN}/api/application/servers`, {
            method: 'POST',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${config.PLTA}`
            },
            body: JSON.stringify({
                name: safeServerName,
                description: '',
                user: userId,
                egg: parseInt(config.EGG),
                docker_image: 'ghcr.io/parkervcp/yolks:nodejs_20',
                startup: 'npm install && npm start',
                environment: { INST: 'npm', USER_UPLOAD: '0', AUTO_UPDATE: '0', CMD_RUN: 'npm start' },
                limits: { memory: parseInt(ram), swap: 0, disk: parseInt(disk), io: 500, cpu: parseInt(cpu) },
                feature_limits: { databases: 5, backups: 5, allocations: 1 },
                deploy: { locations: [parseInt(config.LOX)], dedicated_ip: false, port_range: [] }
            })
        });

        const serverData = await serverResponse.json();
        if (serverData.errors) throw new Error(serverData.errors[0].detail || 'Gagal membuat server');

        return {
            success: true,
            serverId: serverData.attributes.id,
            identifier: serverData.attributes.identifier,
            name: safeServerName,
            panelType,
            ram, disk, cpu,
            createdAt: new Date().toISOString(),
            panelUrl: `${config.URL}/server/${serverData.attributes.identifier}`
        };
    } catch (error) {
        throw error;
    }
}

//━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 🎯 HELPER FUNCTIONS
//━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function generateRandomPassword(length = 8) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let password = '';
    for (let i = 0; i < length; i++) password += chars.charAt(Math.floor(Math.random() * chars.length));
    return password;
}

function capitalize(string) {
    return string.charAt(0).toUpperCase() + string.slice(1).toLowerCase();
}

function generateOrderId() {
    return `ORDER_${Date.now()}_${Math.random().toString(36).substr(2, 9).toUpperCase()}`;
}

function escapeHTML(text) {
    if (!text) return '';
    return text.toString()
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

//━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 📊 API ROUTES
//━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// 📌 Endpoint untuk mencatat kunjungan (notifikasi Telegram)
app.post('/api/visit', async (req, res) => {
    try {
        const { referrer, userAgent, screen, language, timezone } = req.body;
        const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
        const message = `
🆕 *Ada pengunjung baru di website panel!*
🌐 IP: ${ip}
🕐 Waktu: ${new Date().toLocaleString('id-ID')}
💻 Browser: ${userAgent || 'N/A'}
📱 Resolusi: ${screen || 'N/A'}
🗣️ Bahasa: ${language || 'N/A'}
⏰ Timezone: ${timezone || 'N/A'}
🔗 Referrer: ${referrer || 'Langsung'}
        `;
        const url = `https://api.telegram.org/bot${config.TELEGRAM_TOKEN}/sendMessage`;
        await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: config.OWNER_ID,
                text: message,
                parse_mode: 'Markdown'
            })
        });
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// 1. CREATE Order
app.post('/api/create-order', async (req, res) => {
    try {
        const { email, panel_type } = req.body;
        if (!email || !panel_type) {
            return res.status(400).json({ success: false, message: 'Email dan tipe panel harus diisi' });
        }
        const priceMap = {
            '1gb': config.PRICE_1GB, '2gb': config.PRICE_2GB, '3gb': config.PRICE_3GB,
            '4gb': config.PRICE_4GB, '5gb': config.PRICE_5GB, '6gb': config.PRICE_6GB,
            '7gb': config.PRICE_7GB, '8gb': config.PRICE_8GB, '9gb': config.PRICE_9GB,
            '10gb': config.PRICE_10GB, 'unli': config.PRICE_UNLI, 'unlimited': config.PRICE_UNLI
        };
        const amount = priceMap[panel_type] || 500;
        if (amount <= 0) return res.status(400).json({ success: false, message: 'Harga tidak valid' });

        const orderId = generateOrderId();
        const payment = await processPayment(orderId, amount);
        if (!payment) return res.status(500).json({ success: false, message: 'Gagal membuat pembayaran' });

        const order = {
            order_id: orderId,
            email, panel_type, amount,
            payment_number: payment.payment_number,
            qris_string: payment.qris_string,
            status: 'pending',
            created_at: new Date().toISOString(),
            panel_created: false
        };
        orders.set(orderId, order);

        const qrUrl = `https://quickchart.io/qr?text=${encodeURIComponent(payment.qris_string)}&size=300&margin=1`;
        res.json({ success: true, order, qr_url: qrUrl, payment_info: payment });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
});

// 2. CHECK Payment Status
app.get('/api/check-payment/:orderId', async (req, res) => {
    try {
        const { orderId } = req.params;
        const paymentStatus = await checkPaymentStatus(orderId);
        if (!paymentStatus) return res.status(500).json({ success: false, message: 'Gagal memeriksa status' });

        const order = orders.get(orderId);
        if (order) {
            order.status = paymentStatus.status;
            orders.set(orderId, order);
        }
        res.json({ success: true, status: paymentStatus.status, order_id: orderId });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
});

// 3. CREATE Panel setelah pembayaran berhasil
app.post('/api/create-panel', async (req, res) => {
    try {
        const { order_id, email, panel_type } = req.body;
        if (!order_id) return res.status(400).json({ success: false, message: 'Order ID diperlukan' });

        const order = orders.get(order_id);
        if (!order) return res.status(404).json({ success: false, message: 'Order tidak ditemukan' });

        const paidStatuses = ['paid', 'success', 'settled'];
        if (!paidStatuses.includes(order.status)) {
            return res.status(400).json({ success: false, message: 'Pembayaran belum berhasil. Status: ' + order.status });
        }
        if (order.panel_created) return res.status(400).json({ success: false, message: 'Panel sudah dibuat sebelumnya' });

        const panelResult = await createPterodactylServer(
            'user_' + Date.now(),
            panel_type || order.panel_type,
            (email || order.email).split('@')[0]
        );
        if (!panelResult.success) return res.status(500).json({ success: false, message: 'Gagal membuat panel' });

        order.panel_created = true;
        order.panel_data = panelResult;
        orders.set(order_id, order);

        // Notifikasi Telegram ke owner
        const ownerMsg = `<blockquote>✅ PANEL BARU DIBUAT</blockquote>\n\n` +
            `<b>📅 Waktu:</b> ${new Date().toLocaleString('id-ID')}\n` +
            `<b>📧 Email:</b> ${escapeHTML(order.email)}\n` +
            `<b>📦 Tipe Panel:</b> ${order.panel_type.toUpperCase()}\n` +
            `<b>💰 Harga:</b> Rp ${order.amount.toLocaleString('id-ID')}\n` +
            `<b>🆔 Server ID:</b> <code>${panelResult.serverId}</code>\n` +
            `<b>🏷️ Nama Server:</b> ${escapeHTML(panelResult.name)}\n` +
            `<b>💾 RAM:</b> ${panelResult.ram === 0 ? 'Unlimited' : panelResult.ram + 'MB'}\n` +
            `<b>💿 Disk:</b> ${panelResult.disk === 0 ? 'Unlimited' : panelResult.disk + 'MB'}\n` +
            `<b>⚡ CPU:</b> ${panelResult.cpu === 0 ? 'Unlimited' : panelResult.cpu + '%'}`;

        try {
            const url = `https://api.telegram.org/bot${config.TELEGRAM_TOKEN}/sendMessage`;
            await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: config.OWNER_ID,
                    text: ownerMsg,
                    parse_mode: 'HTML'
                })
            });
        } catch (telegramError) {}

        res.json({ success: true, panel: panelResult, message: 'Panel berhasil dibuat!' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message || 'Internal server error' });
    }
});

//━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 🎨 ROUTE UTAMA (toko.html)
//━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
app.get('/', async (req, res) => {
    try {
        let html = await fs.readFile(path.join(__dirname, 'toko.html'), 'utf-8');
        const configData = {
            VERSI_WEB: config.VERSI_WEB,
            DEVELOPER: config.DEVELOPER,
            PRICE_1GB: config.PRICE_1GB,
            PRICE_2GB: config.PRICE_2GB,
            PRICE_3GB: config.PRICE_3GB,
            PRICE_4GB: config.PRICE_4GB,
            PRICE_5GB: config.PRICE_5GB,
            PRICE_6GB: config.PRICE_6GB,
            PRICE_7GB: config.PRICE_7GB,
            PRICE_8GB: config.PRICE_8GB,
            PRICE_9GB: config.PRICE_9GB,
            PRICE_10GB: config.PRICE_10GB,
            PRICE_UNLI: config.PRICE_UNLI
        };
        html = html.replace(/{{VERSI_WEB}}/g, config.VERSI_WEB);
        html = html.replace(/{{DEVELOPER}}/g, config.DEVELOPER);
        html = html.replace('{{CONFIG_SCRIPT}}', JSON.stringify(configData));
        res.send(html);
    } catch (err) {
        console.error(err);
        res.status(500).send('Error loading page');
    }
});

// Untuk Vercel, export app
module.exports = app;

// Jika dijalankan langsung (bukan di Vercel)
if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`Server running at http://localhost:${PORT}`);
    });
}