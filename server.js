// UI Web Route: Serves the visual dashboard directly to the browser
app.get('/admin', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <title>Chat Core Server Dashboard</title>
      <script src="https://cdn.tailwindcss.com"></script>
    </head>
    <body class="bg-gray-900 text-gray-100 font-sans p-6">
      <div class="max-w-7xl mx-auto">
        <header class="mb-8 border-b border-gray-800 pb-4 flex justify-between items-center">
          <h1 class="text-3xl font-extrabold text-indigo-400">Chat Ecosystem Dashboard</h1>
          <span class="bg-green-500/20 text-green-400 text-xs px-2.5 py-1 rounded-full border border-green-500/30 font-medium">Live Telemetry Active</span>
        </header>

        <!-- Grid Layout -->
        <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
          
          <!-- Column 1: Online Status -->
          <div class="bg-gray-800 p-5 rounded-xl border border-gray-700 shadow-xl">
            <h2 class="text-xl font-bold text-gray-200 mb-4 flex items-center gap-2">
              <span class="w-3 h-3 bg-green-500 rounded-full animate-pulse"></span> Currently Online
            </h2>
            <ul id="online-list" class="space-y-2"></ul>
          </div>

          <!-- Column 2: Session Timeline Tracking (Time-In / Time-Out) -->
          <div class="bg-gray-800 p-5 rounded-xl border border-gray-700 shadow-xl lg:col-span-2">
            <h2 class="text-xl font-bold text-gray-200 mb-4 text-indigo-300">User Session Logs (Time-In & Out)</h2>
            <div class="overflow-x-auto">
              <table class="w-full text-left border-collapse">
                <thead>
                  <tr class="border-b border-gray-700 text-gray-400 text-sm">
                    <th class="pb-2">Username</th>
                    <th class="pb-2">Time In</th>
                    <th class="pb-2">Time Out</th>
                    <th class="pb-2">Status</th>
                  </tr>
                </thead>
                <tbody id="session-table-body" class="text-sm divide-y divide-gray-700/50"></tbody>
              </table>
            </div>
          </div>

          <!-- Column 3: Encrypted Chat History Repository -->
          <div class="bg-gray-800 p-5 rounded-xl border border-gray-700 shadow-xl lg:col-span-3 mt-4">
            <h2 class="text-xl font-bold text-red-400 mb-4">Encrypted Database Message Vault (AES-256 Hex Storage)</h2>
            <div class="overflow-x-auto">
              <table class="w-full text-left border-collapse">
                <thead>
                  <tr class="border-b border-gray-700 text-gray-400 text-sm">
                    <th class="pb-2">Timestamp</th>
                    <th class="pb-2">Sender</th>
                    <th class="pb-2">Recipient</th>
                    <th class="pb-2">Secure IV Token</th>
                    <th class="pb-2">Ciphertext (Encrypted Payload)</th>
                  </tr>
                </thead>
                <tbody id="vault-table-body" class="text-xs font-mono divide-y divide-gray-700/50"></tbody>
              </table>
            </div>
          </div>

        </div>
      </div>

      <script>
        async function fetchTelemetry() {
          try {
            const res = await fetch('/api/admin/data');
            const data = await res.json();
            
            // 1. Render Online Users
            const onlineList = document.getElementById('online-list');
            onlineList.innerHTML = data.currentlyOnline.length === 0 
              ? '<p class="text-gray-500 text-sm italic">No users active currently.</p>'
              : data.currentlyOnline.map(user => \`
                  <li class="bg-gray-700/40 border border-gray-700 px-3 py-2 rounded-lg flex items-center justify-between text-sm">
                    <span class="font-medium text-gray-300">\${user}</span>
                    <span class="w-2 h-2 bg-green-400 rounded-full"></span>
                  </li>
                \`).join('');

            // 2. Render Session Logs
            const sessionBody = document.getElementById('session-table-body');
            sessionBody.innerHTML = data.sessionTrackingLogs.length === 0
              ? '<tr><td colspan="4" class="py-4 text-center text-gray-500 italic">No session history records found.</td></tr>'
              : data.sessionTrackingLogs.map(log => \`
                  <tr class="text-gray-300">
                    <td class="py-2.5 font-medium">\${log.username}</td>
                    <td class="py-2.5 text-gray-400">\${new Date(log.timeIn).toLocaleString()}</td>
                    <td class="py-2.5 text-gray-400">\${log.timeOut ? new Date(log.timeOut).toLocaleString() : '-'}</td>
                    <td class="py-2.5">
                      <span class="\${log.timeOut ? 'text-gray-500' : 'text-green-400 font-medium'}">
                        \${log.timeOut ? 'Disconnected' : 'Active Session'}
                      </span>
                    </td>
                  </tr>
                \`).join('');

            // 3. Render Encrypted Chat History
            const vaultBody = document.getElementById('vault-table-body');
            vaultBody.innerHTML = data.encryptedVaultRecords.length === 0
              ? '<tr><td colspan="5" class="py-4 text-center text-gray-500 italic">Vault empty. No payloads recorded.</td></tr>'
              : data.encryptedVaultRecords.map(msg => \`
                  <tr class="text-gray-400 border-b border-gray-800/40">
                    <td class="py-2 text-indigo-300">\${new Date(msg.timestamp).toLocaleTimeString()}</td>
                    <td class="py-2 text-gray-300 font-sans font-semibold">\${msg.sender}</td>
                    <td class="py-2 text-gray-300 font-sans font-semibold">\${msg.recipient}</td>
                    <td class="py-2 text-yellow-500/80 break-all max-w-[150px] pr-4">\${msg.iv}</td>
                    <td class="py-2 text-red-400/80 break-all">\${msg.encryptedMessage}</td>
                  </tr>
                \`).join('');

          } catch (error) {
            console.error('Telemetry dashboard failed to refresh:', error);
          }
        }

        // Initialize and poll dashboard telemetry every 5 seconds
        fetchTelemetry();
        setInterval(fetchTelemetry, 5000);
      </script>
    </body>
    </html>
  `);
});

// 5. Server Initialization 
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server executing securely on port ${PORT}`);
});
