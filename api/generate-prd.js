export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
    if (req.method === 'OPTIONS') {
      return res.status(200).end();
    }
  
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }
  
    try {
      const { brief } = req.body;
      const apiKey = process.env.ANTHROPIC_API_KEY;
  
      if (!apiKey || !brief) {
        return res.status(400).json({ error: 'Missing API key or brief' });
      }
  
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 2000,
          messages: [{ role: 'user', content: brief }],
        }),
      });
  
      const data = await response.json();
  
      if (!response.ok) {
        console.error('API Error:', data);
        return res.status(response.status).json({ error: data });
      }
  
      res.status(200).json(data);
    } catch (error) {
      console.error('Error:', error.message);
      res.status(500).json({ error: error.message });
    }
  }