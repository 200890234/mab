// Self-contained Microsoft Edge online neural TTS client.
//
// The published npm `edge-tts` package is stale and gets HTTP 403 because it lacks the
// Sec-MS-GEC anti-bot token that Microsoft now requires. This module re-implements the
// same protocol (ref: https://github.com/rany2/edge-tts, drm.py) so the app needs no
// external dependency or Python runtime. Output is an mp3 Buffer.
//
// Usage:
//   const { tts } = require('./tts-edge');
//   const mp3 = await tts('hello world', { voice: 'en-US-AriaNeural' });

const crypto = require('crypto');
const WebSocket = require('ws');

const TRUSTED_CLIENT_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
const CHROMIUM_FULL_VERSION = '143.0.3650.75';
const SEC_MS_GEC_VERSION = '1-' + CHROMIUM_FULL_VERSION;
const WIN_EPOCH = 11644473600; // seconds between 1601-01-01 and 1970-01-01
const S_TO_NS = 1e9;

const WSS_URL =
    `wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1` +
    `?TrustedClientToken=${TRUSTED_CLIENT_TOKEN}`;

// Generate the Sec-MS-GEC proof-of-work token (mirrors edge-tts DRM.generate_sec_ms_gec).
function generateSecMsGec() {
    let ticks = Date.now() / 1000 + WIN_EPOCH;
    ticks -= ticks % 300;            // round down to nearest 5 minutes
    ticks *= S_TO_NS / 100;          // to 100-nanosecond intervals (Windows file time)
    const strToHash = `${Math.floor(ticks)}${TRUSTED_CLIENT_TOKEN}`;
    return crypto.createHash('sha256').update(strToHash, 'ascii').digest('hex').toUpperCase();
}

function connectionId() {
    return crypto.randomUUID().replace(/-/g, '');
}

function muid() {
    return crypto.randomBytes(16).toString('hex').toUpperCase();
}

/**
 * Synthesize `text` to an mp3 Buffer using Edge's online neural voices.
 * @param {string} text
 * @param {{voice?: string, rate?: string, pitch?: string, volume?: string}} [options]
 * @returns {Promise<Buffer>}
 */
function tts(text, options = {}) {
    const {
        voice = 'en-US-AriaNeural',
        volume = '+0%',
        rate = '+0%',
        pitch = '+0Hz'
    } = options;

    const token = generateSecMsGec();
    const url = `${WSS_URL}&ConnectionId=${connectionId()}&Sec-MS-GEC=${token}&Sec-MS-GEC-Version=${SEC_MS_GEC_VERSION}`;

    const headers = {
        'Origin': 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold',
        'User-Agent': `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ` +
            `(KHTML, like Gecko) Chrome/${CHROMIUM_FULL_VERSION} Safari/537.36 Edg/${CHROMIUM_FULL_VERSION}`,
        'Cookie': `muid=${muid()};`
    };

    return new Promise((resolve, reject) => {
        const ws = new WebSocket(url, { headers });

        const audioData = [];
        let settled = false;

        ws.on('message', (rawData, isBinary) => {
            if (!isBinary) {
                const data = rawData.toString('utf8');
                if (data.includes('turn.end')) {
                    settled = true;
                    ws.close();
                    resolve(Buffer.concat(audioData));
                }
                return;
            }
            const data = rawData;
            const separator = 'Path:audio\r\n';
            const idx = data.indexOf(separator);
            if (idx !== -1) {
                audioData.push(data.subarray(idx + separator.length));
            }
        });

        ws.on('error', (err) => {
            if (!settled) reject(err);
        });

        const speechConfig = JSON.stringify({
            context: {
                synthesis: {
                    audio: {
                        metadataoptions: { sentenceBoundaryEnabled: false, wordBoundaryEnabled: false },
                        outputFormat: 'audio-24khz-48kbitrate-mono-mp3'
                    }
                }
            }
        });
        const configMessage =
            `X-Timestamp:${new Date().toString()}\r\n` +
            `Content-Type:application/json; charset=utf-8\r\n` +
            `Path:speech.config\r\n\r\n${speechConfig}`;

        ws.on('open', () => {
            ws.send(configMessage, { compress: true }, (configErr) => {
                if (configErr) return reject(configErr);
                const ssmlMessage =
                    `X-RequestId:${connectionId()}\r\n` +
                    `Content-Type:application/ssml+xml\r\n` +
                    `X-Timestamp:${new Date().toISOString()}Z\r\n` +
                    `Path:ssml\r\n\r\n` +
                    `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'>` +
                    `<voice name='${voice}'><prosody pitch='${pitch}' rate='${rate}' volume='${volume}'>` +
                    `${text}</prosody></voice></speak>`;
                ws.send(ssmlMessage, { compress: true }, (ssmlErr) => {
                    if (ssmlErr) reject(ssmlErr);
                });
            });
        });
    });
}

module.exports = { tts };
