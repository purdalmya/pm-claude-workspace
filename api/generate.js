export default async function handler(req, res) {
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      return res.status(200).end();
    }
  
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }
  
    const { brief } = req.body;
    const API_KEY = 'sk-ant-api03-LxBSNGKN6htrUGqw'; // Hardcoded for testing
  
    if (!brief) {
      return res.status(400).json({ error: 'Brief is required' });
    }
  
    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': API_KEY,
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 2000,
          messages: [{ role: 'user', content: brief }],
        }),
      });
  
      const data = await response.json();
  
      if (!response.ok) {
        console.error('Anthropic API error:', data);
        return res.status(response.status).json({ error: data.error || 'API error' });
      }
  
      res.setHeader('Access-Control-Allow-Origin', '*');
      return res.status(200).json(data);
    } catch (error) {
      console.error('Backend error:', error);
      return res.status(500).json({ error: error.message });
    }
  }