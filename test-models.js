const https = require('https');
const fs = require('fs');
const dotenv = require('dotenv');

const env = dotenv.parse(fs.readFileSync('.env'));
const key = env.GEMINI_API_KEY;

const models = [
  'gemini-3.5-flash',
  'gemini-2.5-flash',
  'gemini-flash-latest',
  'gemini-2.0-flash-lite',
  'gemini-3-flash-preview'
];

models.forEach(model => {
  const req = https.request({
    hostname: 'generativelanguage.googleapis.com',
    path: `/v1beta/models/${model}:generateContent?key=${key}`,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, res => {
    let body = '';
    res.on('data', chunk => body += chunk);
    res.on('end', () => {
      console.log(`[${model}] -> Status ${res.statusCode}`);
      if (res.statusCode === 200) {
        console.log(`>>> SUCCESS ON [${model}]! Answer:`, JSON.parse(body).candidates[0].content.parts[0].text);
      } else {
        console.log(`[${model}] error:`, body.substring(0, 120));
      }
    });
  });

  req.write(JSON.stringify({ contents: [{ parts: [{ text: 'Respond with: "J.A.R.V.I.S. Online"' }] }] }));
  req.end();
});
