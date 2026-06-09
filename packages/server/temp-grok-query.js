const http = require('http');

const requestData = JSON.stringify({
  model: 'grok-4-fast',
  messages: [
    {
      role: 'user',
      content: 'Please fetch and summarize this X/Twitter post in detail, including the author, main message, any links mentioned, and the overall topic: https://x.com/omarsar0/status/1986099467914023194'
    }
  ],
  temperature: 0.3,
  max_tokens: 2000
});

const options = {
  hostname: 'localhost',
  port: 4000,
  path: '/v1/messages',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': requestData.length
  }
};

const req = http.request(options, (res) => {
  let data = '';
  res.on('data', (chunk) => data += chunk);
  res.on('end', () => {
    console.log('Response:', data);
  });
});

req.on('error', (error) => {
  console.error('Error:', error.message);
});

req.write(requestData);
req.end();
