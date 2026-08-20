const https = require('https');
const fs = require('fs');
const dotenv = require('dotenv');

const env = dotenv.parse(fs.readFileSync('.env'));
const key = env.GEMINI_API_KEY;

https.get(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`, res => {
  let body = '';
  res.on('data', c => body += c);
  res.on('end', () => {
    console.log('HTTP Status:', res.statusCode);
    try {
      const parsed = JSON.parse(body);
      if (parsed.models) {
        console.log('Available Models:');
        parsed.models.forEach(m => console.log('-', m.name, m.supportedGenerationMethods));
      } else {
        console.log('Error/Output:', parsed);
      }
    } catch(e) {
      console.log('Raw output:', body);
    }
  });
});
