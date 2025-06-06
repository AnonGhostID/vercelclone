const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

// Download and setup rclone if not exists
async function setupRclone() {
  const rclonePath = '/tmp/rclone';
  
  if (!fs.existsSync(rclonePath)) {
    console.log('Downloading rclone...');
    const fetch = require('node-fetch');
    const AdmZip = require('adm-zip');

    
    // Download rclone binary
    const { execSync } = require('child_process');
    try {
      const response = await fetch('https://downloads.rclone.org/rclone-current-linux-amd64.zip');
      if (!response.ok) {
        throw new Error(`Failed to download rclone: ${response.statusText}`);
      }
      const buffer = await response.buffer();
      fs.writeFileSync('/tmp/rclone.zip', buffer);

      const zip = new AdmZip('/tmp/rclone.zip');
      const rcloneEntry = zip.getEntries().find(e => /\/rclone$/.test(e.entryName));
      if (!rcloneEntry) {
        throw new Error('rclone binary not found in archive');
      }
      
      // Extract the entire zip first
      zip.extractAllTo('/tmp', true);
      
      // Find the actual extracted rclone binary path
      const extractedPath = path.join('/tmp', rcloneEntry.entryName);
      
      // Move it to the expected location
      fs.renameSync(extractedPath, rclonePath);
      fs.chmodSync(rclonePath, 0o755);
      
      // Clean up the zip file and extracted directory
      fs.unlinkSync('/tmp/rclone.zip');
      const extractedDir = path.dirname(extractedPath);
      if (fs.existsSync(extractedDir) && extractedDir !== '/tmp') {
        fs.rmSync(extractedDir, { recursive: true, force: true });
      }
      
      console.log('Rclone setup complete');
    } catch (error) {
      console.error('Failed to setup rclone:', error);
      throw error;
    }
  }
  
  return rclonePath;
}

// Setup rclone config
function setupConfig() {
  const configPath = '/tmp/rclone.conf';
  
  if (process.env.CONFIG_BASE64) {
    const configContent = Buffer.from(process.env.CONFIG_BASE64, 'base64').toString('utf-8');
    fs.writeFileSync(configPath, configContent);
    console.log('Config loaded from base64');
  } else if (process.env.CONFIG_URL) {
    // Note: In a real implementation, you'd fetch this asynchronously
    console.log('Config URL method not implemented in this example');
    fs.writeFileSync(configPath, '[combine]\ntype = alias\nremote = dummy');
  } else {
    fs.writeFileSync(configPath, '[combine]\ntype = alias\nremote = dummy');
  }
  
  // Add combine remote if not exists
  const contents = fs.readFileSync(configPath, 'utf-8');
  if (!contents.includes('[combine]')) {
    const remotes = contents.match(/^\[([^\]]+)\]/gm);
    if (remotes && remotes.length > 0) {
      const remoteNames = remotes.map(r => r.slice(1, -1));
      const upstreams = remoteNames.map(name => `${name}=${name}:`).join(' ');
      fs.appendFileSync(configPath, `\n\n[combine]\ntype = combine\nupstreams = ${upstreams}`);
    }
  }
  
  return configPath;
}

// Execute rclone command
async function executeRclone(command, args) {
  return new Promise((resolve, reject) => {
    const process = spawn(command, args, {
      stdio: ['pipe', 'pipe', 'pipe']
    });
    
    let stdout = '';
    let stderr = '';
    
    process.stdout.on('data', (data) => {
      stdout += data.toString();
    });
    
    process.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    
    process.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error(`Process exited with code ${code}: ${stderr}`));
      }
    });
    
    // Set timeout for the process
    setTimeout(() => {
      process.kill();
      reject(new Error('Process timeout'));
    }, 25000); // 25 seconds timeout
  });
}

// Generate HTML listing
function generateHTML(entries, currentPath, isDarkMode = false) {
  const breadcrumbs = currentPath.split('/').filter(Boolean);
  const breadcrumbLinks = breadcrumbs.map((crumb, index) => {
    const link = '/' + breadcrumbs.slice(0, index + 1).join('/');
    return { text: crumb, link };
  });
  breadcrumbLinks.unshift({ text: 'Home', link: '/' });
  
  const template = isDarkMode ? getDarkTemplate() : getLightTemplate();
  
  return template
    .replace(/{{\.Name}}/g, currentPath || 'Root')
    .replace(/{{range \$i, \$crumb := \.Breadcrumb}}.*{{end}}/g, 
      breadcrumbLinks.map(crumb => `<a href="${crumb.link}">${crumb.text}</a>`).join('/')
    )
    .replace(/{{- range \.Entries}}.*{{- end}}/gs, 
      entries.map(entry => `
        <tr class="file">
          <td></td>
          <td>
            ${entry.isDir ? 
              '<svg width="1.5em" height="1em" version="1.1" viewBox="0 0 317 259"><use xlink:href="#folder"></use></svg>' :
              '<svg width="1.5em" height="1em" version="1.1" viewBox="0 0 265 323"><use xlink:href="#file"></use></svg>'
            }
            <a href="${entry.url}"><span class="name">${entry.name}</span></a>
          </td>
          <td data-order="${entry.size || -1}">${entry.isDir ? '&mdash;' : `<size>${entry.size || 0}</size>`}</td>
          <td class="hideable">${entry.modTime || '&mdash;'}</td>
          <td class="hideable"></td>
        </tr>
      `).join('')
    );
}

function getLightTemplate() {
  // Return basic light template (simplified version)
  return `<!DOCTYPE html>
<html>
<head>
  <title>{{.Name}}</title>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { font-family: sans-serif; margin: 20px; }
    table { width: 100%; border-collapse: collapse; }
    th, td { text-align: left; padding: 8px; border-bottom: 1px solid #ddd; }
    th { background-color: #f2f2f2; }
    a { text-decoration: none; color: #0066cc; }
    a:hover { text-decoration: underline; }
    .name { margin-left: 0.5em; }
  </style>
</head>
<body>
  <h1>{{range $i, $crumb := .Breadcrumb}}<a href="{{$crumb.Link}}">{{$crumb.Text}}</a>{{if ne $i 0}}/{{end}}{{end}}</h1>
  <table>
    <thead>
      <tr><th></th><th>Name</th><th>Size</th><th>Modified</th><th></th></tr>
    </thead>
    <tbody>
      <tr><td></td><td><a href=".."><span class="name">Go up</span></a></td><td>&mdash;</td><td>&mdash;</td><td></td></tr>
      {{- range .Entries}}{{- end}}
    </tbody>
  </table>
</body>
</html>`;
}

function getDarkTemplate() {
  // Return the dark template from the repo
  return fs.readFileSync(path.join(__dirname, '../templates/dark.html'), 'utf-8');
}

module.exports = async (req, res) => {
  try {
    // Set CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') {
      res.status(200).end();
      return;
    }
    
    // Setup rclone
    const rclonePath = await setupRclone();
    const configPath = setupConfig();
    
    // Get the requested path
    const requestPath = req.url === '/' ? '' : req.url.slice(1);
    
    // Check authentication
    if (process.env.USERNAME && process.env.PASSWORD) {
      const auth = req.headers.authorization;
      if (!auth || !auth.startsWith('Basic ')) {
        res.setHeader('WWW-Authenticate', 'Basic realm="Rclone Index"');
        res.status(401).json({ error: 'Authentication required' });
        return;
      }
      
      const [username, password] = Buffer.from(auth.slice(6), 'base64').toString().split(':');
      if (username !== process.env.USERNAME || password !== process.env.PASSWORD) {
        res.status(401).json({ error: 'Invalid credentials' });
        return;
      }
    }
    
    // List directory contents using rclone
    const args = [
      'lsjson',
      `combine:${requestPath}`,
      '--config', configPath
    ];
    
    const result = await executeRclone(rclonePath, args);
    const entries = JSON.parse(result.stdout || '[]');
    
    // Format entries for HTML
    const formattedEntries = entries.map(entry => ({
      name: entry.Name,
      url: `/${requestPath}${requestPath ? '/' : ''}${entry.Name}${entry.IsDir ? '/' : ''}`,
      isDir: entry.IsDir,
      size: entry.Size,
      modTime: entry.ModTime
    }));
    
    // Generate and return HTML
    const isDarkMode = process.env.DARK_MODE?.toLowerCase() === 'true';
    const html = generateHTML(formattedEntries, requestPath, isDarkMode);
    
    res.setHeader('Content-Type', 'text/html');
    res.status(200).send(html);
    
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      details: error.message 
    });
  }
};