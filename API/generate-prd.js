export default async function handler(req, res) {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }
  
    const { brief, type } = req.body;
    const apiKey = process.env.ANTHROPIC_API_KEY;
  
    if (!apiKey) {
      return res.status(400).json({ error: 'API key not configured' });
    }
  
    try {
      const systemPrompt = type === 'comprehensive'
        ? `You are a senior product manager...` // Add your prompt here
        : `You are a scrappy PM...`; // Add your short prompt here
  
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 2000,
          system: systemPrompt,
          messages: [{ role: 'user', content: brief }],
        }),
      });
  
      const data = await response.json();
      res.status(200).json(data);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }