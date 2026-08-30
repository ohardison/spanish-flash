const express = require('express');
const path = require('path');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// Serve Supabase configuration to the client (anon key + url)
app.get('/config', (req, res) => {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    return res.status(500).json({ error: 'Supabase not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY in .env.' });
  }

  return res.json({ supabaseUrl, supabaseAnonKey });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
