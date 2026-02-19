const express = require('express');
const fetch = require('node-fetch');
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require("path");
const config = require('./setting.js');
const fs = require('fs').promises;

const app = express();
const PORT = config.PORT || 8080;
const HOST = config.HOST || 'localhost';

// In-memory storage untuk order
const orders = new Map();

app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname))); // biar bisa akses file statis di root

//━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 📦 PAKASIR PAYMENT FUNCTIONS
//━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
async function createQRISPayment(orderId, amount) {
    try {
        const response = await fetch('https://app.pakasir.com/api/transactioncreate/qris', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            body: JSON.stringify({
                project: config.PAKASIR_PROJECT,
                api_key: config.PAKASIR_API_KEY,
                order_id: orderId,
                amount: amount
            })
        });

        const data = await response.json();

        if (!data.success && !data.payment) {
            return null;
        }

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

        // Normalize status
        let status = transaction.status || '';
        if (typeof status === 'string') {
            status = status.toLowerCase();
            if (status === 'success') status = 'paid';
            if (status === 'settled') status = 'paid';
        }

        return {
            success: true,
            status: status,
            transaction: transaction,
            raw: data
        };
    } catch (error) {
        return null;
    }
}

async function processPayment(orderId, amount) {
    try {
        const qrData = await createQRISPayment(orderId, amount);
        if (!qrData) {
            throw new Error('Gagal membuat pembayaran QRIS');
        }
        return qrData;
    } catch (error) {
        throw error;
    }
}

//━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 🖥️ CREATE PTERODACTYL SERVER
//━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
async function createPterodactylServer(userId, panelType, username, serverName = null) {
    try {
        let ram, disk, cpu;

        if (panelType === 'unli' || panelType === 'unlimited') {
            ram = 0;
            disk = 0;
            cpu = 0;
        } else {
            switch (panelType) {
                case '1gb': ram = 1024; disk = 1024; cpu = 40; break;
                case '2gb': ram = 2048; disk = 2048; cpu = 60; break;
                case '3gb': ram = 3072; disk = 3072; cpu = 80; break;
                case '4gb': ram = 4096; disk = 4096; cpu = 100; break;
                case '5gb': ram = 5120; disk = 5120; cpu = 120; break;
                case '6gb': ram = 6144; disk = 6144; cpu = 140; break;
                case '7gb': ram = 7168; disk = 7168; cpu = 160; break;
                case '8gb': ram = 8192; disk = 8192; cpu = 180; break;
                case '9gb': ram = 9216; disk = 9216; cpu = 200; break;
                case '10gb': ram = 10240; disk = 10240; cpu = 220; break;
                default: ram = 1024; disk = 1024; cpu = 40;
            }
        }

        const serverCount = 1;
        const safeServerName = serverName ||
            (panelType === 'unli' || panelType === 'unlimited'
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
                environment: {
                    INST: 'npm',
                    USER_UPLOAD: '0',
                    AUTO_UPDATE: '0',
                    CMD_RUN: 'npm start'
                },
                limits: {
                    memory: parseInt(ram),
                    swap: 0,
                    disk: parseInt(disk),
                    io: 500,
                    cpu: parseInt(cpu)
                },
                feature_limits: {
                    databases: 5,
                    backups: 5,
                    allocations: 1
                },
                deploy: {
                    locations: [parseInt(config.LOX)],
                    dedicated_ip: false,
                    port_range: []
                }
            })
        });

        const serverData = await serverResponse.json();

        if (serverData.errors) {
            throw new Error(serverData.errors[0].detail || 'Gagal membuat server');
        }

        return {
            success: true,
            serverId: serverData.attributes.id,
            identifier: serverData.attributes.identifier,
            name: safeServerName,
            panelType: panelType,
            ram: ram,
            disk: disk,
            cpu: cpu,
            createdAt: new Date().toISOString(),
            panelUrl: `${config.URL}/server/${serverData.attributes.identifier}`
        };
    } catch (error) {
        throw error;
    }
}

//━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 🎯 HELPER FUNCTIONS
//━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function generateRandomPassword(length = 8) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let password = '';
    for (let i = 0; i < length; i++) {
        password += chars.charAt(Math.floor(Math.random() * chars.length));
    }
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

//━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 📊 ROUTES API
//━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// 1. CREATE Order
app.post('/api/create-order', async (req, res) => {
    try {
        const { email, panel_type } = req.body;

        if (!email || !panel_type) {
            return res.status(400).json({
                success: false,
                message: 'Email dan tipe panel harus diisi'
            });
        }

        // Get price from config
        const priceMap = {
            '1gb': config.PRICE_1GB || 500,
            '2gb': config.PRICE_2GB || 500,
            '3gb': config.PRICE_3GB || 500,
            '4gb': config.PRICE_4GB || 500,
            '5gb': config.PRICE_5GB || 500,
            '6gb': config.PRICE_6GB || 500,
            '7gb': config.PRICE_7GB || 500,
            '8gb': config.PRICE_8GB || 500,
            '9gb': config.PRICE_9GB || 500,
            '10gb': config.PRICE_10GB || 500,
            'unli': config.PRICE_UNLI || 500,
            'unlimited': config.PRICE_UNLI || 500
        };

        const amount = priceMap[panel_type] || 500;

        if (amount <= 0) {
            return res.status(400).json({
                success: false,
                message: 'Harga tidak valid'
            });
        }

        const orderId = generateOrderId();

        // Buat pembayaran
        const payment = await processPayment(orderId, amount);

        if (!payment) {
            return res.status(500).json({
                success: false,
                message: 'Gagal membuat pembayaran'
            });
        }

        // Simpan order
        const order = {
            order_id: orderId,
            email: email,
            panel_type: panel_type,
            amount: amount,
            payment_number: payment.payment_number,
            qris_string: payment.qris_string,
            status: 'pending',
            created_at: new Date().toISOString(),
            panel_created: false
        };

        orders.set(orderId, order);

        // Generate QR Code URL
        const qrUrl = `https://quickchart.io/qr?text=${encodeURIComponent(payment.qris_string)}&size=300&margin=1`;

        res.json({
            success: true,
            order: order,
            qr_url: qrUrl,
            payment_info: payment
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
});

// 2. CHECK Payment Status
app.get('/api/check-payment/:orderId', async (req, res) => {
    try {
        const { orderId } = req.params;
        const paymentStatus = await checkPaymentStatus(orderId);

        if (!paymentStatus) {
            return res.status(500).json({
                success: false,
                message: 'Gagal memeriksa status pembayaran'
            });
        }

        // Update order status
        const order = orders.get(orderId);
        if (order) {
            order.status = paymentStatus.status;
            orders.set(orderId, order);
        }

        res.json({
            success: true,
            status: paymentStatus.status,
            order_id: orderId,
            transaction: paymentStatus.transaction
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
});

// 3. CREATE Panel setelah pembayaran berhasil
app.post('/api/create-panel', async (req, res) => {
    try {
        const { order_id, email, panel_type } = req.body;

        if (!order_id) {
            return res.status(400).json({
                success: false,
                message: 'Order ID diperlukan'
            });
        }

        // Cek apakah order ada dan sudah dibayar
        const order = orders.get(order_id);
        if (!order) {
            return res.status(404).json({
                success: false,
                message: 'Order tidak ditemukan'
            });
        }

        // Validasi status pembayaran
        const paidStatuses = ['paid', 'success', 'settled'];
        if (!paidStatuses.includes(order.status)) {
            return res.status(400).json({
                success: false,
                message: 'Pembayaran belum berhasil. Status: ' + order.status
            });
        }

        if (order.panel_created) {
            return res.status(400).json({
                success: false,
                message: 'Panel sudah dibuat sebelumnya'
            });
        }

        // Buat panel di Pterodactyl
        const panelResult = await createPterodactylServer(
            'user_' + Date.now(),
            panel_type || order.panel_type,
            (email || order.email).split('@')[0]
        );

        if (!panelResult.success) {
            return res.status(500).json({
                success: false,
                message: 'Gagal membuat panel'
            });
        }

        // Update order
        order.panel_created = true;
        order.panel_data = panelResult;
        orders.set(order_id, order);

        // Kirim notifikasi ke Telegram dengan format HTML
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

        const ownerKeyboard = {
            inline_keyboard: [
                [
                    {
                        text: '🛒 Beli Panel',
                        url: config.URL
                    }
                ]
            ]
        };

        // Kirim notifikasi ke Telegram
        try {
            const url = `https://api.telegram.org/bot${config.TELEGRAM_TOKEN}/sendMessage`;
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: config.OWNER_ID,
                    text: ownerMsg,
                    parse_mode: 'HTML',
                    reply_markup: ownerKeyboard
                })
            });

            const result = await response.json();
            if (!result.ok) {
                // Silent fail for Telegram errors
            }
        } catch (telegramError) {
            // Silent fail for Telegram errors
        }

        res.json({
            success: true,
            panel: panelResult,
            message: 'Panel berhasil dibuat!'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message || 'Internal server error'
        });
    }
});

//━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 🎨 ROUTE UTAMA (HTML) - BACA FILE DARI ROOT
//━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
app.get('/', async (req, res) => {
    try {
        let html = await fs.readFile(path.join(__dirname, 'toko.html'), 'utf-8');

        // Siapkan data konfigurasi untuk dikirim ke client
        const configData = {
            VERSI_WEB: config.VERSI_WEB,
            DEVELOPER: config.DEVELOPER,
            PRICE_1GB: config.PRICE_1GB || 500,
            PRICE_2GB: config.PRICE_2GB || 500,
            PRICE_3GB: config.PRICE_3GB || 500,
            PRICE_4GB: config.PRICE_4GB || 500,
            PRICE_5GB: config.PRICE_5GB || 500,
            PRICE_6GB: config.PRICE_6GB || 500,
            PRICE_7GB: config.PRICE_7GB || 500,
            PRICE_8GB: config.PRICE_8GB || 500,
            PRICE_9GB: config.PRICE_9GB || 500,
            PRICE_10GB: config.PRICE_10GB || 500,
            PRICE_UNLI: config.PRICE_UNLI || 500
        };

        // Ganti placeholder di HTML
        html = html.replace(/{{VERSI_WEB}}/g, config.VERSI_WEB);
        html = html.replace(/{{DEVELOPER}}/g, config.DEVELOPER);
        html = html.replace('{{CONFIG_SCRIPT}}', JSON.stringify(configData));

        res.send(html);
    } catch (err) {
        console.error(err);
        res.status(500).send('Error loading page');
    }
});

//━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 🚀 START SERVER
//━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
app.listen(PORT, HOST, () => {
    console.log(`
\x1b[1m\x1b[34m╔═╗╦ ╦╦═╗╦ ╦╔╦╗╔═╗╔═╗╦  \x1b[0m
\x1b[1m\x1b[34m╠═╝╚╦╝╠╦╝║ ║ ║ ║╣ ╠═╝║  \x1b[0m
\x1b[1m\x1b[34m╩   ╩ ╩╚═╚═╝ ╩ ╚═╝╩  ╩═╝\x1b[0m
\x1b[1m\x1b[33mN O V A B O T   P A N E L   v${config.VERSI_WEB}\x1b[0m
\x1b[1m\x1b[32m═══════════════════════════════════════\x1b[0m
🌐 Server: http://${HOST}:${PORT}
👤 Developer: ${config.DEVELOPER}
📦 Version: ${config.VERSI_WEB}
✅ Server ready!
`);
});