const https = require('https');
const fs = require('fs');
const dotenv = require('dotenv');

if (!fs.existsSync('.env')) {
  console.log('No .env file found');
  process.exit(1);
}

const env = dotenv.parse(fs.readFileSync('.env'));
const key = env.GEMINI_API_KEY;

if (!key) {
  console.log('No GEMINI_API_KEY in .env');
  process.exit(1);
}

console.log('Testing key ending in:', key.slice(-4));

const modelsToTest = [
  'gemini-2.5-flash',
  'gemini-2.0-flash',
  'gemini-1.5-flash-latest',
  'gemini-1.5-pro',
  'gemini-pro'
];

modelsToTest.forEach(model => {
  const req = https.request({
    hostname: 'generativelanguage.googleapis.com',
    path: `/v1beta/models/${model}:generateContent?key=${key}`,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, res => {
    let body = '';
    res.on('data', chunk => body += chunk);
    res.on('end', () => {
      console.log(`Model [${model}] -> HTTP ${res.statusCode}`);
      if (res.statusCode === 200) {
        console.log(`SUCCESS [${model}]! Response:`, body.substring(0, 150));
      } else {
        try {
          const parsed = JSON.parse(body);
          console.log(`ERROR [${model}]:`, parsed.error?.message || body.substring(0, 100));
        } catch(e) {
          console.log(`RAW [${model}]:`, body.substring(0, 100));
        }
      }
    });
  });

  req.write(JSON.stringify({ contents: [{ parts: [{ text: 'Respond with "Hello Master Sumit"' }] }] }));
  req.end();
});
