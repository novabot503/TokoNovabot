const express = require('express');
const fetch = require('node-fetch');
const bodyParser = require('body-parser');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const config = require('./setting.js');

const app = express();
const PORT = config.PORT || 8080;
const HOST = config.HOST || 'localhost';

//━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 📦 DATABASE SEDERHANA (Order Storage)
//━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const ORDERS_FILE = 'orders.json';
let orders = new Map();

// Load orders dari file
function loadOrders() {
    try {
        if (fs.existsSync(ORDERS_FILE)) {
            const data = fs.readFileSync(ORDERS_FILE, 'utf8');
            const ordersArray = JSON.parse(data || '[]');
            orders = new Map();
            ordersArray.forEach(order => {
                if (order && order.order_id) {
                    orders.set(order.order_id, order);
                }
            });
            console.log(`✅ Orders loaded: ${orders.size} orders`);
        }
    } catch (error) {
        console.log('❌ Error loading orders:', error.message);
        orders = new Map();
    }
}

// Save orders ke file
function saveOrders() {
    try {
        const ordersArray = Array.from(orders.values());
        fs.writeFileSync(ORDERS_FILE, JSON.stringify(ordersArray, null, 2));
    } catch (error) {
        console.log('❌ Error saving orders:', error.message);
    }
}

// Update order dan simpan
function updateOrder(orderId, orderData) {
    orders.set(orderId, orderData);
    saveOrders();
}

//━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ⚙️ MIDDLEWARE
//━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'));

//━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 📦 PAKASIR PAYMENT FUNCTIONS (DIPERBAIKI)
//━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// 1. CREATE QRIS PAYMENT
async function createQRISPayment(orderId, amount) {
    try {
        console.log(`🔄 Membuat pembayaran QRIS: ${orderId} - Rp ${amount}`);
        
        const response = await fetch('https://app.pakasir.com/api/transactioncreate/qris', {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'Authorization': `Bearer ${config.PAKASIR_API_KEY}`
            },
            body: JSON.stringify({
                project: config.PAKASIR_PROJECT,
                api_key: config.PAKASIR_API_KEY,
                order_id: orderId,
                amount: amount,
                payment_type: 'qris',
                customer_name: 'NovaBot Customer',
                customer_email: 'customer@novabot.id'
            })
        });
        
        const data = await response.json();
        console.log('📡 Response Pakasir:', JSON.stringify(data));
        
        if (!data.success) {
            console.log('❌ Pakasir error:', data.message || 'Unknown error');
            return null;
        }
        
        const payment = data.payment || data;
        return {
            success: true,
            payment_number: payment.payment_number || payment.code || '',
            qris_string: payment.payment_number || payment.qris_string || payment.qr_content || '',
            raw: data,
            expiry_time: payment.expiry_time || new Date(Date.now() + 3600000).toISOString() // 1 jam
        };
    } catch (error) {
        console.error('❌ Error createQRISPayment:', error);
        return null;
    }
}

// 2. CHECK PAYMENT STATUS (DIPERBAIKI)
async function checkPaymentStatus(orderId) {
    try {
        console.log(`🔍 Checking payment status for: ${orderId}`);
        
        const response = await fetch('https://app.pakasir.com/api/transaction/status', {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'Authorization': `Bearer ${config.PAKASIR_API_KEY}`
            },
            body: JSON.stringify({
                project: config.PAKASIR_PROJECT,
                api_key: config.PAKASIR_API_KEY,
                order_id: orderId
            })
        });
        
        const data = await response.json();
        console.log('📡 Status check result:', JSON.stringify(data));
        
        if (!data.success) {
            return {
                success: false,
                status: 'error',
                message: data.message || 'Gagal cek status'
            };
        }
        
        // Normalize status sesuai Pakasir
        let status = data.status || '';
        let normalizedStatus = 'pending';
        
        if (['PAID', 'SUCCESS', 'SETTLED'].includes(status.toUpperCase())) {
            normalizedStatus = 'paid';
        } else if (['EXPIRED', 'FAILED'].includes(status.toUpperCase())) {
            normalizedStatus = 'expired';
        } else if (status.toUpperCase() === 'PENDING') {
            normalizedStatus = 'pending';
        }
        
        return {
            success: true,
            status: normalizedStatus,
            original_status: status,
            transaction: data,
            raw: data
        };
        
    } catch (error) {
        console.error('❌ Error checkPaymentStatus:', error);
        return null;
    }
}

// 3. PROCESS PAYMENT WRAPPER
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
// 📞 WEBHOOK PAKASIR (BARU)
//━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
app.post('/api/pakasir-webhook', async (req, res) => {
    try {
        const webhookData = req.body;
        console.log('📱 Webhook diterima dari Pakasir:', JSON.stringify(webhookData));
        
        // 1. Validasi data webhook
        if (!webhookData || !webhookData.order_id) {
            console.log('⚠️ Webhook tidak valid: missing order_id');
            return res.status(400).json({ success: false, message: 'Invalid webhook data' });
        }
        
        const { order_id, status, amount } = webhookData;
        
        // 2. Cari order di database
        const order = orders.get(order_id);
        if (!order) {
            console.log(`⚠️ Order tidak ditemukan: ${order_id}`);
            
            // Coba sync dengan Pakasir
            const paymentStatus = await checkPaymentStatus(order_id);
            if (paymentStatus && paymentStatus.success) {
                console.log(`🔄 Order ditemukan di Pakasir, status: ${paymentStatus.status}`);
                // Buat order baru dengan data dari Pakasir
                const newOrder = {
                    order_id: order_id,
                    amount: amount || 500,
                    status: paymentStatus.status,
                    created_at: new Date().toISOString(),
                    panel_created: false
                };
                updateOrder(order_id, newOrder);
            }
            
            return res.status(200).json({ success: true, message: 'Webhook processed' });
        }
        
        // 3. Update status pembayaran
        let paymentStatus = order.status;
        if (['PAID', 'SUCCESS', 'SETTLED'].includes(status?.toUpperCase())) {
            paymentStatus = 'paid';
        } else if (['EXPIRED', 'FAILED'].includes(status?.toUpperCase())) {
            paymentStatus = 'expired';
        } else if (status?.toUpperCase() === 'PENDING') {
            paymentStatus = 'pending';
        }
        
        console.log(`🔄 Update status order ${order_id}: ${order.status} → ${paymentStatus}`);
        
        // 4. Update order
        order.status = paymentStatus;
        order.updated_at = new Date().toISOString();
        updateOrder(order_id, order);
        
        // 5. Jika bayar sukses dan panel belum dibuat, buat panel
        if (paymentStatus === 'paid' && !order.panel_created) {
            console.log(`🔄 Trigger auto panel creation for: ${order_id}`);
            
            // Delay sebentar sebelum membuat panel
            setTimeout(async () => {
                try {
                    const panelResponse = await fetch(`http://localhost:${PORT}/api/create-panel`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ order_id: order_id })
                    });
                    
                    const panelResult = await panelResponse.json();
                    console.log(`Panel creation result: ${panelResult.success ? '✅' : '❌'}`, panelResult.message);
                } catch (panelError) {
                    console.error('Error creating panel from webhook:', panelError);
                }
            }, 3000); // Tunggu 3 detik
        }
        
        // 6. Response ke Pakasir
        res.json({ 
            success: true, 
            message: 'Webhook processed successfully',
            order_id: order_id,
            status: paymentStatus
        });
        
    } catch (error) {
        console.error('❌ Error processing webhook:', error);
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
});

//━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 🎯 HELPER FUNCTIONS (TIDAK BERUBAH)
//━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function generateRandomPassword(length = 12) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
    let password = '';
    for (let i = 0; i < length; i++) {
        password += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return password;
}

function capitalize(string) {
    if (!string) return '';
    return string.charAt(0).toUpperCase() + string.slice(1).toLowerCase();
}

function generateOrderId() {
    return `NOVA_${Date.now()}_${Math.random().toString(36).substr(2, 6).toUpperCase()}`;
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

function cleanUsername(username) {
    let cleaned = username.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
    if (cleaned.length < 3) {
        cleaned = cleaned + Math.floor(Math.random() * 1000);
    }
    if (cleaned.length > 20) {
        cleaned = cleaned.substring(0, 20);
    }
    return cleaned;
}

//━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 🖥️ PTERODACTYL FUNCTIONS (TIDAK BERUBAH)
//━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
async function createPterodactylUser(panelName) {
    try {
        const username = cleanUsername(panelName);
        const password = generateRandomPassword();
        const email = `${username}@panel.novabot`;
        
        console.log(`🔄 Membuat user Pterodactyl: ${username}`);
        
        const response = await fetch(`${config.DOMAIN}/api/application/users`, {
            method: 'POST',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${config.PLTA}`
            },
            body: JSON.stringify({
                email: email,
                username: username,
                first_name: panelName,
                last_name: 'Panel',
                language: 'en',
                password: password,
                root_admin: false
            })
        });
        
        const userData = await response.json();
        
        if (userData.errors) {
            if (userData.errors[0].detail && userData.errors[0].detail.includes('already been taken')) {
                const randomNum = Math.floor(Math.random() * 1000);
                const newUsername = `${username}${randomNum}`;
                const newEmail = `${newUsername}@panel.novabot.id`;
                
                console.log(`🔄 Username sudah ada, mencoba: ${newUsername}`);
                
                const retryResponse = await fetch(`${config.DOMAIN}/api/application/users`, {
                    method: 'POST',
                    headers: {
                        'Accept': 'application/json',
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${config.PLTA}`
                    },
                    body: JSON.stringify({
                        email: newEmail,
                        username: newUsername,
                        first_name: panelName,
                        last_name: 'Panel',
                        language: 'en',
                        password: password,
                        root_admin: false
                    })
                });
                
                const retryData = await retryResponse.json();
                
                if (retryData.errors) {
                    throw new Error(retryData.errors[0].detail || 'Gagal membuat user');
                }
                
                console.log(`✅ User berhasil dibuat (dengan username baru): ${newUsername}`);
                return {
                    success: true,
                    userId: retryData.attributes.id,
                    username: newUsername,
                    password: password,
                    email: newEmail
                };
            }
            throw new Error(userData.errors[0].detail || 'Gagal membuat user');
        }
        
        console.log(`✅ User berhasil dibuat: ${username}`);
        return {
            success: true,
            userId: userData.attributes.id,
            username: username,
            password: password,
            email: email
        };
    } catch (error) {
        console.error('Error creating Pterodactyl user:', error);
        throw error;
    }
}

async function createPterodactylServer(userId, panelType, panelName) {
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

        const serverName = panelType === 'unli' || panelType === 'unlimited' 
            ? `${capitalize(panelName)} UNLI Server`
            : `${capitalize(panelName)} ${panelType.toUpperCase()} Server`;

        console.log(`🔄 Membuat server: ${serverName} untuk user: ${userId}`);
        
        const serverResponse = await fetch(`${config.DOMAIN}/api/application/servers`, {
            method: 'POST',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${config.PLTA}`
            },
            body: JSON.stringify({
                name: serverName,
                description: 'Panel otomatis oleh NovaBot',
                user: parseInt(userId),
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

        console.log(`✅ Server berhasil dibuat: ${serverName}`);
        return {
            success: true,
            serverId: serverData.attributes.id,
            identifier: serverData.attributes.identifier,
            name: serverName,
            panelType: panelType,
            ram: ram,
            disk: disk,
            cpu: cpu,
            createdAt: new Date().toISOString(),
            panelUrl: `${config.URL}/server/${serverData.attributes.identifier}`
        };
    } catch (error) {
        console.error('Error creating server:', error);
        throw error;
    }
}

//━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 📨 TELEGRAM NOTIFICATION (TIDAK BERUBAH)
//━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
async function sendTelegramNotification(panelInfo, order) {
    try {
        if (!config.TELEGRAM_TOKEN || !config.OWNER_ID) {
            console.log('Telegram token atau owner ID tidak dikonfigurasi');
            return;
        }

        const ownerMsg = `<blockquote>✅ PANEL BARU DIBUAT</blockquote>\n\n` +
            `<b>📅 Waktu:</b> ${new Date().toLocaleString('id-ID')}\n` +
            `<b>📧 Email Panel:</b> ${escapeHTML(panelInfo.email)}\n` +
            `<b>👤 Username:</b> <code>${escapeHTML(panelInfo.username)}</code>\n` +
            `<b>🔑 Password:</b> <code>${escapeHTML(panelInfo.password)}</code>\n` +
            `<b>📦 Tipe Panel:</b> ${panelInfo.panel_type.toUpperCase()}\n` +
            `<b>💰 Harga:</b> Rp ${order.amount.toLocaleString('id-ID')}\n` +
            `<b>🆔 Server ID:</b> <code>${panelInfo.server_id}</code>\n` +
            `<b>🏷️ Nama Server:</b> ${escapeHTML(panelInfo.server_name)}\n` +
            `<b>💾 RAM:</b> ${panelInfo.ram === 0 || panelInfo.ram === '0MB' ? 'Unlimited' : panelInfo.ram}\n` +
            `<b>💿 Disk:</b> ${panelInfo.disk === 0 || panelInfo.disk === '0MB' ? 'Unlimited' : panelInfo.disk}\n` +
            `<b>⚡ CPU:</b> ${panelInfo.cpu === 0 || panelInfo.cpu === '0%' ? 'Unlimited' : panelInfo.cpu}\n` +
            `<b>🔗 Panel URL:</b> ${panelInfo.panel_url}`;

        const ownerKeyboard = {
            inline_keyboard: [
                [
                    { 
                        text: '🛒 Beli Panel', 
                        url: config.URL || `http://${HOST}:${PORT}`
                    }
                ]
            ]
        };

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
        if (result.ok) {
            console.log('✅ Notifikasi Telegram berhasil dikirim');
        } else {
            console.log('Telegram notification skipped:', result.description);
        }
    } catch (telegramError) {
        console.log('Telegram notification skipped:', telegramError.message);
    }
}

//━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 📊 API ROUTES (DIPERBAIKI)
//━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// 1. CREATE Order
app.post('/api/create-order', async (req, res) => {
    try {
        const { panel_name, panel_type } = req.body;
        
        if (!panel_name || !panel_type) {
            return res.status(400).json({ 
                success: false, 
                message: 'Nama panel dan tipe panel harus diisi' 
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
        
        // Buat pembayaran QRIS
        const payment = await processPayment(orderId, amount);
        
        if (!payment) {
            return res.status(500).json({ 
                success: false, 
                message: 'Gagal membuat pembayaran QRIS. Cek API key Pakasir.' 
            });
        }

        // Simpan order
        const order = {
            order_id: orderId,
            panel_name: panel_name,
            panel_type: panel_type,
            amount: amount,
            payment_number: payment.payment_number,
            qris_string: payment.qris_string,
            status: 'pending',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            panel_created: false,
            user_data: null,
            server_data: null,
            webhook_received: false
        };

        updateOrder(orderId, order);

        // Generate QR Code URL
        const qrUrl = `https://quickchart.io/qr?text=${encodeURIComponent(payment.qris_string)}&size=300&margin=1&format=png&ecLevel=H`;

        res.json({
            success: true,
            order: order,
            qr_url: qrUrl,
            payment_info: payment,
            webhook_url: `http://${HOST}:${PORT}/api/pakasir-webhook`
        });

    } catch (error) {
        console.error('Create order error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Internal server error: ' + error.message 
        });
    }
});

// 2. CHECK Payment Status (DIPERBAIKI)
app.get('/api/check-payment/:orderId', async (req, res) => {
    try {
        const { orderId } = req.params;
        
        // Cek dulu di local database
        const localOrder = orders.get(orderId);
        
        // Cek status terbaru dari Pakasir
        const paymentStatus = await checkPaymentStatus(orderId);
        
        if (!paymentStatus) {
            return res.status(500).json({ 
                success: false, 
                message: 'Gagal memeriksa status pembayaran' 
            });
        }

        // Update order status di local database
        if (localOrder) {
            localOrder.status = paymentStatus.status;
            localOrder.updated_at = new Date().toISOString();
            updateOrder(orderId, localOrder);
        }

        res.json({
            success: true,
            status: paymentStatus.status,
            original_status: paymentStatus.original_status,
            order_id: orderId,
            transaction: paymentStatus.transaction,
            local_order: localOrder
        });
    } catch (error) {
        console.error('Check payment error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Internal server error' 
        });
    }
});

// 3. CREATE Panel setelah pembayaran berhasil
app.post('/api/create-panel', async (req, res) => {
    try {
        const { order_id } = req.body;
        
        if (!order_id) {
            return res.status(400).json({ 
                success: false, 
                message: 'Order ID diperlukan' 
            });
        }

        // Cek apakah order ada
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
            // Cek ulang ke Pakasir untuk memastikan
            const paymentStatus = await checkPaymentStatus(order_id);
            if (paymentStatus && paidStatuses.includes(paymentStatus.status)) {
                order.status = paymentStatus.status;
                updateOrder(order_id, order);
            } else {
                return res.status(400).json({ 
                    success: false, 
                    message: 'Pembayaran belum berhasil. Status: ' + order.status 
                });
            }
        }

        if (order.panel_created) {
            return res.status(400).json({ 
                success: false, 
                message: 'Panel sudah dibuat sebelumnya' 
            });
        }

        console.log(`🔄 Membuat panel untuk order: ${order_id}`);
        
        // 1. Buat user di Pterodactyl
        console.log(`👤 Membuat user: ${order.panel_name}`);
        const userResult = await createPterodactylUser(order.panel_name);
        
        if (!userResult.success) {
            throw new Error('Gagal membuat user: ' + userResult.message);
        }

        // 2. Buat server untuk user tersebut
        console.log(`🖥️ Membuat server untuk user: ${userResult.userId}`);
        const serverResult = await createPterodactylServer(
            userResult.userId, 
            order.panel_type, 
            order.panel_name
        );

        if (!serverResult.success) {
            throw new Error('Gagal membuat server: ' + serverResult.message);
        }

        // Update order dengan data panel
        order.panel_created = true;
        order.user_data = userResult;
        order.server_data = serverResult;
        order.panel_created_at = new Date().toISOString();
        updateOrder(order_id, order);

        // Siapkan data untuk ditampilkan
        const panelInfo = {
            order_id: order_id,
            panel_name: order.panel_name,
            panel_type: order.panel_type.toUpperCase(),
            username: userResult.username,
            password: userResult.password,
            email: userResult.email,
            server_name: serverResult.name,
            server_id: serverResult.serverId,
            panel_url: serverResult.panelUrl,
            ram: serverResult.ram === 0 ? 'Unlimited' : serverResult.ram + 'MB',
            disk: serverResult.disk === 0 ? 'Unlimited' : serverResult.disk + 'MB',
            cpu: serverResult.cpu === 0 ? 'Unlimited' : serverResult.cpu + '%',
            created_at: new Date().toLocaleString('id-ID'),
            total_paid: 'Rp ' + order.amount.toLocaleString('id-ID')
        };

        // Kirim notifikasi ke Telegram
        await sendTelegramNotification(panelInfo, order);

        res.json({
            success: true,
            message: 'Panel berhasil dibuat!',
            panel_info: panelInfo
        });
    } catch (error) {
        console.error('Create panel error:', error);
        res.status(500).json({ 
            success: false, 
            message: error.message || 'Internal server error' 
        });
    }
});

// 4. GET Order Info
app.get('/api/order/:orderId', (req, res) => {
    try {
        const { orderId } = req.params;
        const order = orders.get(orderId);
        
        if (!order) {
            return res.status(404).json({ 
                success: false, 
                message: 'Order tidak ditemukan' 
            });
        }
        
        res.json({
            success: true,
            order: order
        });
    } catch (error) {
        console.error('Get order error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Internal server error' 
        });
    }
});

// 5. SYNC All Orders with Pakasir
app.get('/api/sync-orders', async (req, res) => {
    try {
        console.log('🔄 Syncing all orders with Pakasir...');
        const allOrders = Array.from(orders.values());
        let synced = 0;
        
        for (const order of allOrders) {
            if (order.status === 'pending') {
                const paymentStatus = await checkPaymentStatus(order.order_id);
                if (paymentStatus && paymentStatus.success) {
                    order.status = paymentStatus.status;
                    order.updated_at = new Date().toISOString();
                    updateOrder(order.order_id, order);
                    synced++;
                    
                    // Jika status paid dan panel belum dibuat
                    if (paymentStatus.status === 'paid' && !order.panel_created) {
                        console.log(`🔄 Order ${order.order_id} sudah dibayar, membuat panel...`);
                        // Trigger panel creation
                        setTimeout(async () => {
                            try {
                                const panelResponse = await fetch(`http://localhost:${PORT}/api/create-panel`, {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ order_id: order.order_id })
                                });
                                console.log(`Panel creation result for ${order.order_id}:`, await panelResponse.json());
                            } catch (panelError) {
                                console.error(`Error creating panel for ${order.order_id}:`, panelError);
                            }
                        }, 1000);
                    }
                }
            }
        }
        
        res.json({
            success: true,
            message: `Synced ${synced} orders`,
            total_orders: allOrders.length,
            synced: synced
        });
    } catch (error) {
        console.error('Sync orders error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Sync error: ' + error.message 
        });
    }
});

//━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 🎨 ROUTE UTAMA (HTML) - SAMA SEPERTI SEBELUMNYA
//━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

app.get('/', (req, res) => {
    const html = `
    <!DOCTYPE html>
    <html lang="id">
    <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
        <title>Novabot Panel</title>
        <link href="https://fonts.googleapis.com/css2?family=Rajdhani:wght@500;600;700&family=Orbitron:wght@500;700;900&family=VT323&display=swap" rel="stylesheet">
        <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css" rel="stylesheet">
        <style>
            /* ========================================= */
            /* 1. RESET & GLOBAL STYLES */
            /* ========================================= */
            :root {
                --bg-main: #02040a;       
                --bg-card: #0b0f19;       
                --primary: #3a6df0;       
                --accent-red: #ff3b30;    
                --accent-gold: #ffcc00;   
                --text-main: #ffffff;
                --text-sub: #8b9bb4;
                --border-color: #1c2538;
            }

            * { 
                box-sizing: border-box; margin: 0; padding: 0; 
                -webkit-tap-highlight-color: transparent; 
                outline: none;
            }
            
            body {
                font-family: 'Rajdhani', sans-serif;
                background: var(--bg-main);
                color: var(--text-main);
                min-height: 100vh;
                display: flex;
                flex-direction: column;
                position: relative; 
                overflow-x: hidden; 
                padding-bottom: 80px; 
            }

            ::-webkit-scrollbar { width: 0px; }

            /* ========================================= */
            /* 2. HEADER */
            /* ========================================= */
            .custom-header {
                position: fixed; top: 0; left: 0; width: 100%; height: 60px;
                background: rgba(2, 4, 10, 0.95); backdrop-filter: blur(10px);
                display: flex; align-items: center; justify-content: space-between;
                padding: 0 20px; z-index: 1000;
                border-bottom: 1px solid var(--border-color);
                box-shadow: 0 4px 15px rgba(0,0,0,0.5);
            }

            .header-left { display: flex; align-items: center; gap: 15px; }
            .header-title { font-family: 'Orbitron', sans-serif; font-size: 20px; font-weight: 700; color: #fff; letter-spacing: 1px; }
            
            /* ========================================= */
            /* 3. DASHBOARD COMPONENTS */
            /* ========================================= */
            .page-container { 
                padding: 80px 20px 20px 20px; 
            }

            .lux-header-card {
                background: linear-gradient(135deg, #1e3c72, #2a5298); 
                border-radius: 20px; padding: 25px 20px; color: white;
                box-shadow: 0 10px 30px rgba(30, 60, 114, 0.3);
                margin-bottom: 30px; position: relative; overflow: hidden;
                border: 1px solid rgba(255,255,255,0.1);
            }
            
            .lux-icon-box { width: 50px; height: 50px; background: rgba(255,255,255,0.2); border-radius: 12px; display: flex; justify-content: center; align-items: center; font-size: 24px; backdrop-filter: blur(5px); }
            
            .lux-head-text h2 { font-family: 'Orbitron'; font-size: 18px; margin-bottom: 2px; letter-spacing: 1px; }
            .lux-head-text p { font-size: 12px; color: rgba(255,255,255,0.8); font-family: 'Rajdhani'; }

            .lux-section-title { 
                font-family: 'Orbitron'; font-size: 16px; color: #fff; 
                margin-bottom: 15px; letter-spacing: 1px; 
                padding-left: 5px; border-left: 3px solid var(--primary); 
                line-height: 1; 
            }

            /* SLIDER */
            .slider-container {
                width: 100%; background: var(--bg-card); border-radius: 20px; overflow: hidden;
                border: 1px solid var(--border-color); box-shadow: 0 5px 20px rgba(0,0,0,0.3);
                margin-bottom: 30px; position: relative; touch-action: pan-y; user-select: none;
                height: 200px;
            }
            
            .slide { 
                min-width: 100%; height: 100%; position: relative; display: block; 
            }
            
            .slide video { 
                width: 100%; height: 100%; object-fit: cover; display: block; 
                border-bottom: 1px solid rgba(255,255,255,0.1); pointer-events: none; 
            }
            
            .lux-news-content { 
                position: absolute; bottom: 0; left: 0; width: 100%; padding: 20px; 
                display: flex; flex-direction: column; justify-content: flex-end;
                background: linear-gradient(to top, rgba(0,0,0,0.95) 0%, rgba(0,0,0,0.6) 50%, transparent 100%);
                z-index: 5;
            }
            
            .lux-news-content h3 { font-family: 'Orbitron'; font-size: 16px; color: #fff; margin-bottom: 5px; text-shadow: 0 2px 4px rgba(0,0,0,0.8); }
            .lux-news-content p { font-size: 12px; color: #d0d0d0; text-shadow: 0 1px 2px rgba(0,0,0,0.8); }

            /* PRICING GRID */
            .pricing-grid {
                display: grid;
                grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
                gap: 15px;
                margin-bottom: 30px;
            }

            .price-card {
                background: var(--bg-card);
                border-radius: 15px;
                padding: 20px;
                text-align: center;
                border: 2px solid var(--border-color);
                transition: all 0.3s ease;
                position: relative;
                overflow: hidden;
            }

            .price-card:hover {
                border-color: var(--primary);
                transform: translateY(-5px);
                box-shadow: 0 10px 25px rgba(58, 109, 240, 0.2);
            }

            .panel-type {
                font-family: 'Orbitron';
                font-size: 1.5rem;
                color: var(--primary);
                margin-bottom: 10px;
                text-transform: uppercase;
            }

            .panel-specs {
                font-size: 0.9rem;
                color: var(--text-sub);
                margin-bottom: 15px;
                line-height: 1.4;
            }

            .price {
                font-size: 2rem;
                font-weight: bold;
                color: var(--accent-gold);
                margin: 15px 0;
            }

            .price-input {
                width: 100%;
                padding: 12px;
                background: rgba(255,255,255,0.1);
                border: 1px solid var(--border-color);
                border-radius: 8px;
                color: white;
                font-family: 'VT323', monospace;
                font-size: 16px;
                margin-bottom: 15px;
                text-align: center;
            }

            .price-input::placeholder {
                color: var(--text-sub);
            }

            .yoshi-btn { 
                width: 100%; 
                padding: 16px; 
                margin-top: 10px; 
                background: linear-gradient(90deg, #1e3c72, #2a5298); 
                border: none; 
                border-radius: 50px; 
                color: #fff; 
                font-family: 'Orbitron'; 
                font-size: 16px; 
                font-weight: bold; 
                cursor: pointer; 
                box-shadow: 0 0 20px rgba(58, 109, 240, 0.3); 
                display: flex; 
                justify-content: center; 
                align-items: center; 
                gap: 10px; 
                transition: 0.2s; 
            }
            
            .yoshi-btn:active { 
                transform: scale(0.98); 
            }

            .yoshi-btn:disabled {
                opacity: 0.5;
                cursor: not-allowed;
            }

            /* MODAL STYLES */
            .modal {
                display: none;
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: rgba(0,0,0,0.95);
                z-index: 2000;
                align-items: center;
                justify-content: center;
                overflow-y: auto;
                padding: 20px;
            }

            .modal-content {
                background: var(--bg-card);
                padding: 30px;
                border-radius: 20px;
                max-width: 500px;
                width: 90%;
                text-align: center;
                border: 2px solid var(--primary);
                box-shadow: 0 0 30px rgba(58, 109, 240, 0.2);
                max-height: 90vh;
                overflow-y: auto;
            }

            .modal h2 {
                font-family: 'Orbitron';
                color: var(--primary);
                margin-bottom: 20px;
                font-size: 1.5rem;
            }

            .qr-container {
                margin: 20px 0;
                padding: 15px;
                background: white;
                border-radius: 10px;
                display: inline-block;
            }

            .qr-container img {
                width: 250px;
                height: 250px;
                display: block;
            }

            .payment-info {
                background: rgba(255,255,255,0.1);
                padding: 15px;
                border-radius: 10px;
                margin: 15px 0;
                font-family: monospace;
                word-break: break-all;
                font-size: 12px;
                color: #fff;
            }

            .status-message {
                margin: 15px 0;
                padding: 15px;
                border-radius: 8px;
                background: rgba(255,255,255,0.1);
                font-size: 14px;
                color: var(--text-sub);
                text-align: left;
            }

            .status-message.success {
                background: rgba(0, 255, 136, 0.1);
                color: #00ff88;
                border: 1px solid #00ff88;
            }

            .status-message.error {
                background: rgba(255, 59, 48, 0.1);
                color: #ff3b30;
                border: 1px solid #ff3b30;
            }

            .status-message.pending {
                background: rgba(255, 204, 0, 0.1);
                color: #ffcc00;
                border: 1px solid #ffcc00;
            }

            .close-btn {
                background: var(--accent-red);
                color: white;
                border: none;
                padding: 12px 25px;
                border-radius: 8px;
                font-family: 'Orbitron';
                cursor: pointer;
                margin-top: 15px;
            }

            /* PANEL INFO MODAL */
            .panel-info-modal {
                display: none;
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: rgba(0,0,0,0.95);
                z-index: 2001;
                align-items: center;
                justify-content: center;
                padding: 20px;
            }

            .panel-info-content {
                background: var(--bg-card);
                padding: 30px;
                border-radius: 20px;
                max-width: 600px;
                width: 90%;
                text-align: left;
                border: 2px solid var(--accent-gold);
                box-shadow: 0 0 40px rgba(255, 204, 0, 0.3);
            }

            .panel-success-header {
                text-align: center;
                margin-bottom: 25px;
                padding-bottom: 15px;
                border-bottom: 1px solid var(--border-color);
            }

            .panel-success-header i {
                font-size: 3rem;
                color: #00ff88;
                margin-bottom: 10px;
            }

            .panel-success-header h2 {
                font-family: 'Orbitron';
                color: #00ff88;
                font-size: 1.8rem;
            }

            .panel-details {
                background: rgba(255,255,255,0.05);
                padding: 20px;
                border-radius: 15px;
                margin: 15px 0;
            }

            .panel-detail-row {
                display: flex;
                justify-content: space-between;
                margin-bottom: 10px;
                padding-bottom: 10px;
                border-bottom: 1px dashed rgba(255,255,255,0.1);
            }

            .panel-detail-label {
                color: var(--text-sub);
                font-weight: 600;
            }

            .panel-detail-value {
                color: #fff;
                font-weight: 600;
                text-align: right;
                word-break: break-all;
            }

            .panel-credentials {
                background: rgba(0, 255, 136, 0.1);
                padding: 20px;
                border-radius: 15px;
                margin: 20px 0;
                border: 1px solid #00ff88;
            }

            .panel-credentials h3 {
                font-family: 'Orbitron';
                color: #00ff88;
                margin-bottom: 15px;
                text-align: center;
            }

            .credential-item {
                margin-bottom: 15px;
            }

            .credential-item:last-child {
                margin-bottom: 0;
            }

            .credential-label {
                color: #00ff88;
                font-size: 0.9rem;
                margin-bottom: 5px;
            }

            .credential-value {
                background: rgba(0,0,0,0.3);
                padding: 12px;
                border-radius: 8px;
                font-family: monospace;
                font-size: 1rem;
                color: #fff;
                word-break: break-all;
                border: 1px solid rgba(0, 255, 136, 0.3);
            }

            .panel-note {
                background: rgba(58, 109, 240, 0.1);
                padding: 15px;
                border-radius: 10px;
                margin: 20px 0;
                font-size: 0.9rem;
                color: var(--text-sub);
                border: 1px solid rgba(58, 109, 240, 0.3);
            }

            .panel-note i {
                color: var(--primary);
                margin-right: 8px;
            }

            /* PANEL NAME MODAL */
            .panel-name-modal {
                display: none;
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: rgba(0,0,0,0.95);
                z-index: 2000;
                align-items: center;
                justify-content: center;
            }

            .panel-name-content {
                background: var(--bg-card);
                padding: 40px 30px;
                border-radius: 20px;
                max-width: 500px;
                width: 90%;
                text-align: center;
                border: 2px solid var(--primary);
                box-shadow: 0 0 40px rgba(58, 109, 240, 0.3);
                position: relative;
            }

            .panel-name-content h2 {
                font-family: 'Orbitron';
                color: var(--primary);
                margin-bottom: 10px;
                font-size: 1.8rem;
            }

            .panel-name-input-group {
                margin: 30px 0;
                position: relative;
            }

            .panel-name-input {
                width: 100%;
                padding: 20px 20px 20px 50px;
                background: rgba(255,255,255,0.1);
                border: 2px solid var(--border-color);
                border-radius: 15px;
                color: white;
                font-family: 'Rajdhani', sans-serif;
                font-size: 18px;
                transition: all 0.3s ease;
            }

            .panel-name-input:focus {
                border-color: var(--primary);
                box-shadow: 0 0 20px rgba(58, 109, 240, 0.3);
                outline: none;
            }

            .panel-name-input::placeholder {
                color: rgba(255,255,255,0.5);
            }

            .panel-name-icon {
                position: absolute;
                left: 15px;
                top: 50%;
                transform: translateY(-50%);
                color: var(--primary);
                font-size: 20px;
            }

            .panel-name-submit-btn {
                width: 100%;
                padding: 20px;
                background: linear-gradient(90deg, #1e3c72, #2a5298);
                border: none;
                border-radius: 15px;
                color: #fff;
                font-family: 'Orbitron';
                font-size: 18px;
                font-weight: bold;
                cursor: pointer;
                box-shadow: 0 0 25px rgba(58, 109, 240, 0.4);
                transition: all 0.3s ease;
                display: flex;
                justify-content: center;
                align-items: center;
                gap: 10px;
            }

            .panel-name-submit-btn:hover {
                transform: translateY(-2px);
                box-shadow: 0 0 35px rgba(58, 109, 240, 0.6);
            }

            .panel-name-submit-btn:active {
                transform: translateY(0);
            }

            .panel-name-note {
                margin-top: 20px;
                color: var(--text-sub);
                font-size: 14px;
                line-height: 1.5;
            }

            .button-group {
                display: flex;
                gap: 10px;
                margin-top: 15px;
            }

            .action-button {
                flex: 1;
                padding: 15px;
                border: none;
                border-radius: 10px;
                font-family: 'Orbitron';
                font-weight: bold;
                cursor: pointer;
                display: flex;
                justify-content: center;
                align-items: center;
                gap: 10px;
                transition: 0.3s;
            }

            .copy-btn {
                background: linear-gradient(90deg, #10b981, #059669);
                color: white;
            }

            .copy-btn:hover {
                background: linear-gradient(90deg, #059669, #047857);
            }

            .login-btn {
                background: linear-gradient(90deg, #3a6df0, #1e3c72);
                color: white;
            }

            .login-btn:hover {
                background: linear-gradient(90deg, #1e3c72, #2a5298);
            }

            /* FOOTER */
            .footer {
                text-align: center;
                padding: 20px;
                margin-top: 30px;
                border-top: 1px solid var(--border-color);
                color: var(--text-sub);
                font-size: 12px;
            }

            @media (max-width: 768px) {
                .pricing-grid {
                    grid-template-columns: 1fr;
                }
                
                .modal-content {
                    padding: 20px;
                }
                
                .qr-container img {
                    width: 200px;
                    height: 200px;
                }
                
                .panel-name-content {
                    padding: 30px 20px;
                }
                
                .button-group {
                    flex-direction: column;
                }
            }
        </style>
    </head>
    <body>
        <!-- HEADER -->
        <div class="custom-header">
            <div class="header-left">
                <div class="header-title">NOVABOT PANEL</div>
            </div>
            <div style="color: var(--text-sub); font-size: 12px;">
                <i class="fas fa-bolt"></i> Powered by NovaBot
            </div>
        </div>

        <!-- MAIN CONTENT -->
        <div class="page-container">
            <!-- HEADER CARD -->
            <div class="lux-header-card">
                <div style="display: flex; align-items: center; gap: 15px; margin-bottom: 15px;">
                    <div class="lux-icon-box"><i class="fas fa-server"></i></div>
                    <div class="lux-head-text">
                        <p>Welcome to</p>
                        <h2>NovaBot Panel Store</h2>
                    </div>
                </div>
                <div style="font-size: 14px; opacity: 0.9;">
                    Jual panel Pterodactyl terbaik dengan harga terjangkau. Pembayaran via QRIS.
                </div>
            </div>

            <!-- NEWS SLIDER -->
            <div class="lux-section-title">Latest News</div>
            <div class="slider-container">
                <div class="slide">
                    <video src="https://files.catbox.moe/7iyjd5.mp4" autoplay muted loop playsinline></video>
                    <div class="lux-news-content">
                        <h3>NovaBot Panel v${config.VERSI_WEB}</h3>
                        <p>Panel Pterodactyl siap pakai dengan sistem pembayaran otomatis</p>
                    </div>
                </div>
            </div>

            <!-- PRICING SECTION -->
            <div class="lux-section-title">Pilih Panel Anda</div>
            
            <div class="pricing-grid" id="pricingGrid">
                <!-- Price cards akan di-generate oleh JavaScript -->
            </div>

            <!-- FOOTER -->
            <div class="footer">
                <p>© 2026 NovaBot Panel - All rights reserved</p>
                <p style="margin-top: 10px;">
                    <i class="fab fa-telegram"></i> ${config.DEVELOPER} • 
                    <i class="fas fa-code"></i> Version ${config.VERSI_WEB}
                </p>
            </div>
        </div>

        <!-- PANEL NAME MODAL -->
        <div id="panelNameModal" class="panel-name-modal">
            <div class="panel-name-content">
                <h2><i class="fas fa-server"></i> Masukkan Nama Panel</h2>
                <p style="color: var(--text-sub); margin-bottom: 20px;">
                    Nama ini akan digunakan untuk login ke panel Anda
                </p>
                <div class="panel-name-input-group">
                    <i class="fas fa-server panel-name-icon"></i>
                    <input type="text" id="panelName" class="panel-name-input" placeholder="contoh: myserver123" required>
                </div>
                <div class="button-group">
                    <button class="yoshi-btn" style="background: linear-gradient(90deg, #6b7280, #4b5563);" onclick="closePanelNameModal()">
                        <i class="fas fa-times"></i> Batal
                    </button>
                    <button class="panel-name-submit-btn" onclick="submitPanelName()">
                        <i class="fas fa-check"></i> Lanjutkan
                    </button>
                </div>
                <div class="panel-name-note">
                    <i class="fas fa-info-circle"></i> Gunakan huruf dan angka saja. Nama akan dijadikan username.
                </div>
            </div>
        </div>

        <!-- PAYMENT MODAL -->
        <div id="paymentModal" class="modal">
            <div class="modal-content">
                <h2><i class="fas fa-qrcode"></i> Bayar dengan QRIS</h2>
                
                <div id="paymentDetails">
                    <!-- Payment details akan dimasukkan di sini -->
                </div>
                
                <div class="button-group">
                    <button class="close-btn" onclick="closePaymentModal()">
                        <i class="fas fa-times"></i> Tutup
                    </button>
                    <button class="yoshi-btn" id="checkStatusBtn" onclick="manualCheckStatus()">
                        <i class="fas fa-sync-alt"></i> Cek Status
                    </button>
                </div>
            </div>
        </div>

        <!-- PANEL INFO MODAL -->
        <div id="panelInfoModal" class="panel-info-modal">
            <div class="panel-info-content">
                <div class="panel-success-header">
                    <i class="fas fa-check-circle"></i>
                    <h2>Panel Berhasil Dibuat!</h2>
                </div>
                
                <div id="panelInfoContent">
                    <!-- Panel info akan dimasukkan di sini -->
                </div>
                
                <div class="panel-note">
                    <i class="fas fa-exclamation-triangle"></i>
                    <b>Catatan Penting:</b> Simpan informasi ini dengan aman. Password tidak dapat diambil kembali.
                </div>
                
                <div class="button-group">
                    <button class="action-button copy-btn" onclick="copyAllCredentials()">
                        <i class="fas fa-copy"></i> Salin Semua
                    </button>
                    <button class="action-button login-btn" id="loginPanelBtn" onclick="openPanelUrl()">
                        <i class="fas fa-external-link-alt"></i> Login Panel
                    </button>
                </div>
                
                <button class="close-btn" style="width: 100%; margin-top: 20px;" onclick="closePanelInfoModal()">
                    <i class="fas fa-times"></i> Tutup
                </button>
            </div>
        </div>

        <script>
            let currentOrder = null;
            let checkInterval = null;
            let currentPrice = 0;
            let currentPanelType = '';
            let currentPanelName = '';
            let panelInfoData = null;

            // Panel data dengan harga dari setting
            const panelData = [
                { type: '1gb', ram: '1GB', disk: '1GB', cpu: '40%', price: ${config.PRICE_1GB || 500} },
                { type: '2gb', ram: '2GB', disk: '2GB', cpu: '60%', price: ${config.PRICE_2GB || 500} },
                { type: '3gb', ram: '3GB', disk: '3GB', cpu: '80%', price: ${config.PRICE_3GB || 500} },
                { type: '4gb', ram: '4GB', disk: '4GB', cpu: '100%', price: ${config.PRICE_4GB || 500} },
                { type: '5gb', ram: '5GB', disk: '5GB', cpu: '120%', price: ${config.PRICE_5GB || 500} },
                { type: '6gb', ram: '6GB', disk: '6GB', cpu: '140%', price: ${config.PRICE_6GB || 500} },
                { type: '7gb', ram: '7GB', disk: '7GB', cpu: '160%', price: ${config.PRICE_7GB || 500} },
                { type: '8gb', ram: '8GB', disk: '8GB', cpu: '180%', price: ${config.PRICE_8GB || 500} },
                { type: '9gb', ram: '9GB', disk: '9GB', cpu: '200%', price: ${config.PRICE_9GB || 500} },
                { type: '10gb', ram: '10GB', disk: '10GB', cpu: '220%', price: ${config.PRICE_10GB || 500} },
                { type: 'unli', ram: 'Unlimited', disk: 'Unlimited', cpu: 'Unlimited', price: ${config.PRICE_UNLI || 500} }
            ];

            // Generate price cards
            function generatePriceCards() {
                const grid = document.getElementById('pricingGrid');
                let html = '';
                
                panelData.forEach(panel => {
                    html += \`
                    <div class="price-card">
                        <div class="panel-type">\${panel.type.toUpperCase()}</div>
                        <div class="panel-specs">
                            <div><i class="fas fa-memory"></i> RAM: \${panel.ram}</div>
                            <div><i class="fas fa-hdd"></i> DISK: \${panel.disk}</div>
                            <div><i class="fas fa-microchip"></i> CPU: \${panel.cpu}</div>
                        </div>
                        <div class="price">Rp \${panel.price.toLocaleString('id-ID')}</div>
                        <button class="yoshi-btn" onclick="openPanelNameModal('\${panel.type}', \${panel.price})">
                            <i class="fas fa-shopping-cart"></i> BELI SEKARANG
                        </button>
                    </div>
                    \`;
                });
                
                grid.innerHTML = html;
            }

            // Open panel name modal
            function openPanelNameModal(panelType, price) {
                currentPanelType = panelType;
                currentPrice = price;
                document.getElementById('panelNameModal').style.display = 'flex';
                document.getElementById('panelName').focus();
            }

            // Close panel name modal
            function closePanelNameModal() {
                document.getElementById('panelNameModal').style.display = 'none';
                document.getElementById('panelName').value = '';
            }

            // Submit panel name
            async function submitPanelName() {
                const panelNameInput = document.getElementById('panelName');
                const panelName = panelNameInput.value.trim();
                
                if (!panelName || panelName.length < 3) {
                    alert('Nama panel minimal 3 karakter!');
                    panelNameInput.focus();
                    return;
                }

                // Validasi hanya huruf dan angka
                if (!/^[a-zA-Z0-9]+$/.test(panelName)) {
                    alert('Nama panel hanya boleh berisi huruf dan angka!');
                    panelNameInput.focus();
                    return;
                }

                currentPanelName = panelName;
                closePanelNameModal();
                await createOrder(panelName, currentPanelType, currentPrice);
            }

            // Create order function
            async function createOrder(panelName, panelType, price) {
                try {
                    const response = await fetch('/api/create-order', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ 
                            panel_name: panelName, 
                            panel_type: panelType
                        })
                    });

                    const data = await response.json();
                    
                    if (data.success) {
                        currentOrder = data.order;
                        showPaymentModal(data, panelName, panelType);
                        startPaymentCheck(data.order.order_id, panelName, panelType);
                    } else {
                        alert(data.message || 'Gagal membuat order');
                    }
                } catch (error) {
                    alert('Terjadi kesalahan, silahkan coba lagi');
                    console.error('Create order error:', error);
                }
            }

            // Show payment modal
            function showPaymentModal(data, panelName, panelType) {
                const modal = document.getElementById('paymentModal');
                const details = document.getElementById('paymentDetails');
                
                let html = \`
                    <div style="text-align: left; margin-bottom: 20px;">
                        <div style="margin-bottom: 10px;">
                            <strong>Order ID:</strong><br>
                            <span style="color: var(--text-sub); font-family: monospace;">\${data.order.order_id}</span>
                        </div>
                        <div style="margin-bottom: 10px;">
                            <strong>Nama Panel:</strong><br>
                            <span style="color: var(--text-sub);">\${panelName}</span>
                        </div>
                        <div style="margin-bottom: 10px;">
                            <strong>Tipe Panel:</strong><br>
                            <span style="color: var(--accent-gold);">\${panelType.toUpperCase()}</span>
                        </div>
                        <div style="margin-bottom: 10px;">
                            <strong>Total Pembayaran:</strong><br>
                            <span style="font-size: 1.5rem; color: var(--accent-gold);">
                                Rp \${currentPrice.toLocaleString('id-ID')}
                            </span>
                        </div>
                    </div>
                    
                    <div class="qr-container">
                        <img src="\${data.qr_url}" alt="QR Code">
                    </div>
                    
                    <div style="margin: 15px 0;">
                        <div><strong>QRIS String:</strong></div>
                        <div class="payment-info">\${data.order.qris_string}</div>
                        <small style="color: var(--text-sub);">Scan dengan aplikasi e-wallet Anda</small>
                    </div>
                    
                    <div id="paymentStatus" class="status-message pending">
                        <i class="fas fa-spinner fa-spin"></i> Menunggu pembayaran...
                    </div>
                    
                    <div style="margin-top: 20px; color: var(--text-sub); font-size: 12px; text-align: center;">
                        <i class="fas fa-clock"></i> QRIS berlaku 1 jam
                    </div>
                \`;
                
                details.innerHTML = html;
                modal.style.display = 'flex';
            }

            // Manual check status
            async function manualCheckStatus() {
                if (!currentOrder) return;
                
                const btn = document.getElementById('checkStatusBtn');
                const originalHtml = btn.innerHTML;
                btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Memeriksa...';
                btn.disabled = true;
                
                await checkPaymentStatus(currentOrder.order_id);
                
                setTimeout(() => {
                    btn.innerHTML = originalHtml;
                    btn.disabled = false;
                }, 1000);
            }

            // Start payment check
            function startPaymentCheck(orderId, panelName, panelType) {
                if (checkInterval) clearInterval(checkInterval);
                
                checkInterval = setInterval(async () => {
                    await checkPaymentStatus(orderId, panelName, panelType);
                }, 5000); // Cek setiap 5 detik
            }

            // Check payment status
            async function checkPaymentStatus(orderId, panelName, panelType) {
                try {
                    const response = await fetch('/api/check-payment/' + orderId);
                    const data = await response.json();
                    
                    if (data.success) {
                        const statusDiv = document.getElementById('paymentStatus');
                        const btn = document.getElementById('checkStatusBtn');
                        
                        if (data.status === 'paid') {
                            statusDiv.innerHTML = '<i class="fas fa-check-circle"></i> Pembayaran berhasil! Membuat panel...';
                            statusDiv.className = 'status-message success';
                            btn.style.background = 'linear-gradient(90deg, #10b981, #059669)';
                            btn.innerHTML = '<i class="fas fa-check"></i> Berhasil';
                            clearInterval(checkInterval);
                            
                            // Buat panel setelah pembayaran berhasil
                            setTimeout(async () => {
                                try {
                                    const panelResponse = await fetch('/api/create-panel', {
                                        method: 'POST',
                                        headers: { 'Content-Type': 'application/json' },
                                        body: JSON.stringify({ 
                                            order_id: orderId
                                        })
                                    });
                                    
                                    const panelData = await panelResponse.json();
                                    
                                    if (panelData.success) {
                                        // Tutup modal pembayaran
                                        closePaymentModal();
                                        
                                        // Simpan data panel
                                        panelInfoData = panelData.panel_info;
                                        
                                        // Tampilkan modal info panel
                                        showPanelInfo(panelData.panel_info);
                                    } else {
                                        statusDiv.innerHTML = '<i class="fas fa-exclamation-triangle"></i> Gagal membuat panel: ' + panelData.message;
                                        statusDiv.className = 'status-message error';
                                    }
                                } catch (panelError) {
                                    statusDiv.innerHTML = '<i class="fas fa-exclamation-triangle"></i> Error membuat panel: ' + panelError.message;
                                    statusDiv.className = 'status-message error';
                                }
                            }, 2000);
                            
                        } else if (data.status === 'expired') {
                            statusDiv.innerHTML = '<i class="fas fa-exclamation-triangle"></i> Pembayaran kadaluarsa';
                            statusDiv.className = 'status-message error';
                            btn.style.background = 'linear-gradient(90deg, #ef4444, #dc2626)';
                            btn.innerHTML = '<i class="fas fa-times"></i> Gagal';
                            clearInterval(checkInterval);
                        } else if (data.status === 'pending') {
                            statusDiv.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Menunggu pembayaran...';
                            statusDiv.className = 'status-message pending';
                        }
                    }
                } catch (error) {
                    console.error('Check status error:', error);
                }
            }

            // Show panel info
            function showPanelInfo(panelInfo) {
                const modal = document.getElementById('panelInfoModal');
                const content = document.getElementById('panelInfoContent');
                
                let html = \`
                    <div class="panel-details">
                        <div class="panel-detail-row">
                            <span class="panel-detail-label">Order ID:</span>
                            <span class="panel-detail-value">\${panelInfo.order_id}</span>
                        </div>
                        <div class="panel-detail-row">
                            <span class="panel-detail-label">Nama Panel:</span>
                            <span class="panel-detail-value">\${panelInfo.panel_name}</span>
                        </div>
                        <div class="panel-detail-row">
                            <span class="panel-detail-label">Tipe Panel:</span>
                            <span class="panel-detail-value">\${panelInfo.panel_type}</span>
                        </div>
                        <div class="panel-detail-row">
                            <span class="panel-detail-label">Server Name:</span>
                            <span class="panel-detail-value">\${panelInfo.server_name}</span>
                        </div>
                        <div class="panel-detail-row">
                            <span class="panel-detail-label">RAM:</span>
                            <span class="panel-detail-value">\${panelInfo.ram}</span>
                        </div>
                        <div class="panel-detail-row">
                            <span class="panel-detail-label">Disk:</span>
                            <span class="panel-detail-value">\${panelInfo.disk}</span>
                        </div>
                        <div class="panel-detail-row">
                            <span class="panel-detail-label">CPU:</span>
                            <span class="panel-detail-value">\${panelInfo.cpu}</span>
                        </div>
                        <div class="panel-detail-row">
                            <span class="panel-detail-label">Total Pembayaran:</span>
                            <span class="panel-detail-value">\${panelInfo.total_paid}</span>
                        </div>
                        <div class="panel-detail-row">
                            <span class="panel-detail-label">Dibuat Pada:</span>
                            <span class="panel-detail-value">\${panelInfo.created_at}</span>
                        </div>
                    </div>
                    
                    <div class="panel-credentials">
                        <h3><i class="fas fa-key"></i> Informasi Login</h3>
                        
                        <div class="credential-item">
                            <div class="credential-label">Panel URL:</div>
                            <div class="credential-value" id="panelUrl">\${panelInfo.panel_url}</div>
                        </div>
                        
                        <div class="credential-item">
                            <div class="credential-label">Username:</div>
                            <div class="credential-value" id="panelUsername">\${panelInfo.username}</div>
                        </div>
                        
                        <div class="credential-item">
                            <div class="credential-label">Password:</div>
                            <div class="credential-value" id="panelPassword">\${panelInfo.password}</div>
                        </div>
                        
                        <div class="credential-item">
                            <div class="credential-label">Email:</div>
                            <div class="credential-value" id="panelEmail">\${panelInfo.email}</div>
                        </div>
                    </div>
                \`;
                
                content.innerHTML = html;
                
                // Set URL untuk login button
                document.getElementById('loginPanelBtn').setAttribute('data-url', panelInfo.panel_url);
                
                modal.style.display = 'flex';
            }

            // Copy all credentials
            function copyAllCredentials() {
                const credentials = \`Panel URL: \${document.getElementById('panelUrl').innerText}
Username: \${document.getElementById('panelUsername').innerText}
Password: \${document.getElementById('panelPassword').innerText}
Email: \${document.getElementById('panelEmail').innerText}
                \`;
                
                navigator.clipboard.writeText(credentials).then(() => {
                    alert('Semua informasi telah disalin ke clipboard!');
                });
            }

            // Open panel URL
            function openPanelUrl() {
                const url = document.getElementById('loginPanelBtn').getAttribute('data-url');
                if (url) {
                    window.open(url, '_blank');
                }
            }

            // Close payment modal
            function closePaymentModal() {
                document.getElementById('paymentModal').style.display = 'none';
                if (checkInterval) clearInterval(checkInterval);
            }

            // Close panel info modal
            function closePanelInfoModal() {
                document.getElementById('panelInfoModal').style.display = 'none';
                panelInfoData = null;
            }

            // Initialize on page load
            document.addEventListener('DOMContentLoaded', function() {
                generatePriceCards();
                
                // Auto-play video
                const videos = document.querySelectorAll('video');
                videos.forEach(video => {
                    video.play().catch(e => {});
                });

                // Enter key untuk panel name modal
                document.getElementById('panelName').addEventListener('keypress', function(e) {
                    if (e.key === 'Enter') {
                        submitPanelName();
                    }
                });
            });
        </script>
    </body>
    </html>
`;
res.send(html);
});

//━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 🚀 START SERVER
//━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// Load orders saat server start
loadOrders();

app.listen(PORT, HOST, () => {
console.log(`
\x1b[1m\x1b[34m╔═╗╦ ╦╦═╗╦ ╦╔╦╗╔═╗╔═╗╦  \x1b[0m
\x1b[1m\x1b[34m╠═╝╚╦╝╠╦╝║ ║ ║ ║╣ ╠═╝║  \x1b[0m
\x1b[1m\x1b[34m╩   ╩ ╩╚═╚═╝ ╩ ╚═╝╩  ╩═╝\x1b[0m
\x1b[1m\x1b[33mN O V A B O T   P A N E L   v${config.VERSI_WEB}\x1b[0m
\x1b[1m\x1b[32m═══════════════════════════════════════\x1b[0m
🌐 Server: http://${HOST}:${PORT}
🔗 Webhook URL: http://${HOST}:${PORT}/api/pakasir-webhook
📊 Orders loaded: ${orders.size}
👤 Developer: ${config.DEVELOPER}
📦 Version: ${config.VERSI_WEB}
✅ Server ready with FIXED PAYMENT SYSTEM!
`);
});