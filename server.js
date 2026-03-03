import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import mammoth from 'mammoth';
import multer from 'multer';
import { fileURLToPath } from 'url';

const app = express();
const PORT = 3000;
const isVercel = Boolean(process.env.VERCEL);

// Get current directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Create uploads folder in a writable location
// - Local/dev: project/uploads
// - Vercel: /tmp/uploads (ephemeral but writable)
const uploadsDir = isVercel ? '/tmp/uploads' : path.join(__dirname, 'uploads');
fs.mkdirSync(uploadsDir, { recursive: true });

// Setup multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    cb(null, file.originalname);
  }
});

const upload = multer({
  storage: storage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
      cb(null, true);
    } else {
      cb(new Error('Only DOCX files are allowed'), false);
    }
  }
});

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// Function to remove diacritics
function removeDiacritics(str) {
  return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

// Function to extract text from DOCX file
async function extractTextFromDocx(filePath) {
  try {
    const result = await mammoth.extractRawText({ path: filePath });
    return result.value;
  } catch (error) {
    console.error(`Error reading ${filePath}:`, error.message);
    return '';
  }
}

// Function to search in text and get context
function searchInText(text, query) {
  const lines = text.split('\n');
  const results = [];
  const normalizedQuery = removeDiacritics(query.toLowerCase());

  lines.forEach((line, lineIndex) => {
    const normalizedLine = removeDiacritics(line.toLowerCase());
    if (normalizedLine.includes(normalizedQuery)) {
      results.push({
        lineNumber: lineIndex + 1,
        text: line.trim(),
        highlighted: line
      });
    }
  });

  return results;
}

// API endpoint for uploading files
app.post('/api/upload', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }
  res.json({ success: true, fileName: req.file.originalname });
});

// API endpoint for getting list of uploaded files
app.get('/api/files', (req, res) => {
  try {
    const files = fs.readdirSync(uploadsDir).filter(f => f.endsWith('.docx'));
    res.json({ files });
  } catch (error) {
    res.status(500).json({ error: 'Could not read files', details: error.message });
  }
});

// API endpoint for deleting a file
app.delete('/api/files/:fileName', (req, res) => {
  try {
    const safeName = path.basename(req.params.fileName);
    const filePath = path.join(uploadsDir, safeName);
    
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      res.json({ success: true, message: 'File deleted' });
    } else {
      res.status(404).json({ error: 'File not found' });
    }
  } catch (error) {
    res.status(500).json({ error: 'Could not delete file', details: error.message });
  }
});

// API endpoint for getting full text of a file
app.get('/api/file/:fileName', async (req, res) => {
  try {
    const safeName = path.basename(req.params.fileName);
    const filePath = path.join(uploadsDir, safeName);
    
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File not found' });
    }
    
    const text = await extractTextFromDocx(filePath);
    res.json({ fileName: safeName, content: text });
  } catch (error) {
    res.status(500).json({ error: 'Could not read file', details: error.message });
  }
});

// API endpoint for searching
app.post('/api/search', async (req, res) => {
  const { query } = req.body;

  if (!query || query.trim().length === 0) {
    return res.json({ results: [] });
  }

  try {
    const files = fs.readdirSync(uploadsDir).filter(f => f.endsWith('.docx'));
    const searchResults = {};

    for (const file of files) {
      const filePath = path.join(uploadsDir, file);
      const text = await extractTextFromDocx(filePath);
      const matches = searchInText(text, query);

      if (matches.length > 0) {
        searchResults[file] = {
          fileName: file,
          matches: matches,
          matchCount: matches.length
        };
      }
    }

    res.json({ 
      results: searchResults,
      totalFiles: files.length,
      filesWithMatches: Object.keys(searchResults).length
    });
  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({ error: 'Search failed', details: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`\n📄 Document Search Server running at http://localhost:${PORT}`);
  console.log(`\n🔍 Open your browser and use the search interface to query your DOCX files`);
});
