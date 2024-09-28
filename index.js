require('dotenv').config();
const express = require('express');
const { Telegraf, Markup } = require('telegraf');
const axios = require('axios');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const app = express();
const bot = new Telegraf(process.env.BOT_TOKEN);

// Check if BOT_TOKEN and BASE_URL are set
if (!process.env.BOT_TOKEN || !process.env.BASE_URL) {
    console.error('Error: BOT_TOKEN or BASE_URL is not set!');
    process.exit(1);
}

// Ensure the downloads directory exists
const downloadsDir = './downloads';
if (!fs.existsSync(downloadsDir)) {
    fs.mkdirSync(downloadsDir);
}

// Function to generate a file download link based on the hash
function generateFileDownloadLink(hash) {
    return `${process.env.BASE_URL}/download/${hash}`;
}

// Function to generate hash
function generateHash(filePath, algorithm = 'sha256') {
    return new Promise((resolve, reject) => {
        const hash = crypto.createHash(algorithm);
        const stream = fs.createReadStream(filePath);

        stream.on('data', (chunk) => hash.update(chunk));
        stream.on('end', () => resolve(hash.digest('hex')));
        stream.on('error', (err) => reject(err));
    });
}

// Function to generate and send hash
async function generateAndSendHash(ctx, fileId, fileName) {
    console.log(`Downloading file: ${fileName}`);
    try {
        const fileLink = await ctx.telegram.getFileLink(fileId);
        const filePath = path.join(downloadsDir, fileName);
        const writer = fs.createWriteStream(filePath);

        const response = await axios({
            url: fileLink.href,
            method: 'GET',
            responseType: 'stream',
            maxContentLength: Infinity,
        });

        response.data.pipe(writer);

        writer.on('finish', async () => {
            const stats = fs.statSync(filePath);
            console.log(`Downloaded file size: ${stats.size} bytes`);
            if (stats.size > 2 * 1024 * 1024 * 1024) {
                console.error('Error: File size exceeds 2GB limit!');
                await ctx.reply('Error: File size exceeds 2GB limit!');
                return;
            }

            try {
                const hash = await generateHash(filePath);
                console.log(`File hash: ${hash}`);

                const newFilePath = path.join(downloadsDir, `${hash}.mp4`);
                fs.renameSync(filePath, newFilePath);

                const photoUrl = 'https://graph.org/file/4e8a1172e8ba4b7a0bdfa.jpg'; // Your photo URL
                await sendPhotoWithLink(ctx, photoUrl, hash, fileName, stats.size);
            } catch (error) {
                console.error('Hash generation error:', error);
                await ctx.reply('Error generating hash!');
            }
        });

        writer.on('error', (error) => {
            console.error('Error writing file:', error);
            ctx.reply('Error downloading file!');
        });

    } catch (error) {
        console.error('Error in generateAndSendHash:', error);
        await ctx.reply('🥹 File size 20MB limit!');
    }
}

// Function to post the file and photo with buttons to a specified channel
async function postToChannel(hash, fileName, fileSize) {
    const filePath = path.join(downloadsDir, `${hash}.mp4`);
    const photoUrl = 'https://graph.org/file/4e8a1172e8ba4b7a0bdfa.jpg'; // Your photo URL

    if (fs.existsSync(filePath)) {
        try {
            const caption = `📁 File: ${fileName}\n📦 Size: ${(fileSize / (1024 * 1024)).toFixed(2)} MB\n\nClick the button below to download:`;

            await bot.telegram.sendPhoto(process.env.CHANNEL_ID, photoUrl, {
                caption: caption,
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: '🔗 Download File 🔗', url: generateFileDownloadLink(hash) }
                        ]
                    ]
                }
            });
            console.log('File posted to channel successfully');
        } catch (error) {
            console.error('Error posting to channel:', error);
        }
    } else {
        console.error('File not found for posting to channel');
    }
}

// Update the sendPhotoWithLink function to call postToChannel automatically
async function sendPhotoWithLink(ctx, photoUrl, hash, fileName, fileSize) {
    const downloadLink = generateFileDownloadLink(hash);

    await ctx.replyWithPhoto(photoUrl, {
        caption: `📁 File: ${fileName}\n📦 Size: ${(fileSize / (1024 * 1024)).toFixed(2)} MB\n\nDownload your file using this link:`,
        reply_markup: {
            inline_keyboard: [
                [
                    { text: '🔗 Download File 🔗', url: downloadLink },
                ]
            ]
        }
    });

    // Automatically post to the channel
    await postToChannel(hash, fileName, fileSize);
}

// Define /start command
bot.start(async (ctx) => {
    const photoUrl = 'https://graph.org/file/4e8a1172e8ba4b7a0bdfa.jpg'; // Photo URL
    const welcomeMessage = '🙄 Welcome! Send me a document or video, and I will generate its hash for you.';

    // Send the photo with the welcome message and join channel button
    await ctx.replyWithPhoto(photoUrl, {
        caption: welcomeMessage,
        reply_markup: {
            inline_keyboard: [
                [
                    { text: '✨ Join Channel ✨', url: 'https://t.me/Opleech_WD' }
                ]
            ]
        }
    });
});

// Define handler for documents
bot.on('document', async (ctx) => {
    const fileId = ctx.message.document.file_id;
    const fileName = ctx.message.document.file_name || `${fileId}.file`;
    await generateAndSendHash(ctx, fileId, fileName);
});

// Define handler for videos
bot.on('video', async (ctx) => {
    const fileId = ctx.message.video.file_id;
    const fileName = ctx.message.video.file_name || `${fileId}.mp4`;
    await generateAndSendHash(ctx, fileId, fileName);
});

// Route to serve the downloaded file
app.get('/download/:hash', (req, res) => {
    const hash = req.params.hash;
    const filePath = path.join(downloadsDir, `${hash}.mp4`);
    if (fs.existsSync(filePath)) {
        res.download(filePath, (err) => {
            if (err) {
                console.error('Error downloading file:', err);
                res.status(500).send('Error downloading file');
            }
        });
    } else {
        res.status(404).send('File not found');
    }
});

// Define a route for root
app.get('/', (req, res) => {
    console.log('Received a request on root path');
    res.send('Bot is running. Send a document or video to generate file hash.');
});

// Use webhook for the bot
app.use(bot.webhookCallback('/webhook'));

// Start the express server
const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
    console.log(`Server is running on port ${PORT}`);
    try {
        await bot.telegram.setWebhook(`${process.env.BASE_URL}/webhook`);
        console.log('Webhook is set');
    } catch (error) {
        console.error('Error setting webhook:', error);
    }
});
