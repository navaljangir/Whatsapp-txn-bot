const { default: makeWASocket, DisconnectReason, useMultiFileAuthState } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const TransactionDao = require('./dao/TransactionDao');

const ALLOWED_NUMBERS = [
    '919649210000@s.whatsapp.net',
    '919413051000@s.whatsapp.net', 
    '919513510000@s.whatsapp.net',
    '919697601000@s.whatsapp.net'
];
const transactionDao = new TransactionDao();

function parseDate(dateStr) {
    const formats = [
        /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/,  // 1/2/25, 01/02/25, 1/2/2025
        /^(\d{1,2})-(\d{1,2})-(\d{2,4})$/,   // 1-2-25, 01-02-25, 1-2-2025
        /^(\d{2})\/(\d{2})\/(\d{4})$/,       // 01/02/2025 (strict)
        /^(\d{2})-(\d{2})-(\d{4})$/          // 01-02-2025 (strict)
    ];
    
    for (let format of formats) {
        const match = dateStr.match(format);
        if (match) {
            let [, day, month, year] = match;
            
            // Convert 2-digit year to 4-digit
            if (year.length === 2) {
                const yearNum = parseInt(year);
                // Assume years 00-30 are 20xx, 31-99 are 19xx
                year = yearNum <= 30 ? '20' + year : '19' + year;
            }
            
            const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
            
            // Validate the date is real (not like Feb 31)
            if (!isNaN(date.getTime()) && 
                date.getDate() === parseInt(day) && 
                date.getMonth() === (parseInt(month) - 1) && 
                date.getFullYear() === parseInt(year)) {
                return date;
            }
        }
    }
    return null;
}


function formatDate(isoString) {
    return new Date(isoString).toLocaleDateString('en-IN');
}

function isValidNumber(number) {
    return /^\d+$/.test(number);
}

function isValidAmount(amount) {
    const num = parseFloat(amount);
    return !isNaN(num) && num > 0;
}

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('./auth_info_baileys');
    
    const sock = makeWASocket({
        auth: state,
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
            console.log('Scan the QR code below to connect to WhatsApp:');
            qrcode.generate(qr, { small: true });
        }
        
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('Connection closed due to ', lastDisconnect.error, ', reconnecting ', shouldReconnect);
            
            if (shouldReconnect) {
                startBot();
            }
        } else if (connection === 'open') {
            console.log('WhatsApp Bot connected successfully!');
        }
    });

    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const from = msg.key.remoteJid;
        const messageText = msg.message.conversation || 
                           msg.message.extendedTextMessage?.text || '';

        if (!ALLOWED_NUMBERS.includes(from)) {
            return;
        }

        console.log(`Received command from authorized user: ${messageText}`);

        const parts = messageText.trim().split(' ');
        const command = parts[0].toLowerCase();

        try {
            switch (command) {
                case 'send':
                    if (parts.length < 3) {
                        await sock.sendMessage(from, { text: 'Usage: send <number> <amount> details="optional information"' });
                        return;
                    }

                    const sendNumber = parts[1];
                    const sendAmount = parts[2];

                    if (!isValidNumber(sendNumber)) {
                        await sock.sendMessage(from, { text: 'Invalid number format. Please use digits only.' });
                        return;
                    }

                    if (!isValidAmount(sendAmount)) {
                        await sock.sendMessage(from, { text: 'Invalid amount. Please enter a positive number.' });
                        return;
                    }

                    const amount = parseFloat(sendAmount);
                    let details = null;

                    if (parts.length > 3) {
                        const detailsPart = parts.slice(3).join(' ');
                        const detailsMatch = detailsPart.match(/details="([^"]*)"/);
                        if (detailsMatch) {
                            details = detailsMatch[1];
                        }
                    }

                    await transactionDao.addTransaction(sendNumber, amount, details);

                    const recipientJid = `91${sendNumber}@s.whatsapp.net`;
                    let recipientMessage = `You have received ₹${amount} from Vipin jangir.`;
                    if (details) {
                        recipientMessage += `\nDetails: ${details}`;
                    }

                    await sock.sendMessage(recipientJid, { 
                        text: recipientMessage
                    });

                    let confirmationMessage = `✅ Sent ₹${amount} notification to ${sendNumber}`;
                    if (details) {
                        confirmationMessage += `\nWith details: ${details}`;
                    }

                    await sock.sendMessage(from, { 
                        text: confirmationMessage
                    });
                    break;

                case 'details':
                    if (parts.length < 2) {
                        await sock.sendMessage(from, { text: 'Usage: details <number> [DD/MM/YY] [10d/5d/1m/1y] [month=9] [month=9 year=25]' });
                        return;
                    }

                    const detailsNumber = parts[1];

                    if (!isValidNumber(detailsNumber)) {
                        await sock.sendMessage(from, { text: 'Invalid number format. Please use digits only.' });
                        return;
                    }

                    let response = `Number: ${detailsNumber}\n`;
                    let filteredTransactions = [];

                    if (parts.length >= 3) {
                        const remainingParts = parts.slice(2);
                        let param = remainingParts[0];
                        
                        // Check if it's a direct date format (DD/MM/YY)
                        const directDate = parseDate(param);
                        if (directDate) {
                            filteredTransactions = await transactionDao.getTransactionsByDate(detailsNumber, directDate);
                            response += `Transactions for ${formatDate(directDate.toISOString())}:\n`;
                        }
                        // Check if it's date= format
                        else if (param.startsWith('date=')) {
                            const dateStr = param.substring(5);
                            const targetDate = parseDate(dateStr);
                            
                            if (!targetDate) {
                                await sock.sendMessage(from, { text: 'Invalid date format. Use DD/MM/YY or DD/MM/YYYY' });
                                return;
                            }
                            
                            filteredTransactions = await transactionDao.getTransactionsByDate(detailsNumber, targetDate);
                            response += `Transactions for ${formatDate(targetDate.toISOString())}:\n`;
                        }
                        // Check if it's month= format
                        else if (param.startsWith('month=')) {
                            const monthStr = param.substring(6);
                            const month = parseInt(monthStr);
                            
                            if (isNaN(month) || month < 1 || month > 12) {
                                await sock.sendMessage(from, { text: 'Invalid month. Use month=1 to month=12' });
                                return;
                            }
                            
                            let year = null;
                            // Check if year is provided in next part
                            if (remainingParts.length > 1 && remainingParts[1].startsWith('year=')) {
                                const yearStr = remainingParts[1].substring(5);
                                year = parseInt(yearStr);
                                if (isNaN(year)) {
                                    await sock.sendMessage(from, { text: 'Invalid year format. Use year=25 or year=2025' });
                                    return;
                                }
                            }
                            
                            filteredTransactions = await transactionDao.getTransactionsByMonth(detailsNumber, month, year);
                            const yearText = year ? (year.toString().length === 2 ? `20${year}` : year.toString()) : new Date().getFullYear().toString();
                            response += `Transactions for month ${month}/${yearText}:\n`;
                        }
                        // Check if it's period format (10d, 5d, etc.)
                        else {
                            const periodMatch = param.match(/^(\d+)([dmy])$/i);
                            if (!periodMatch) {
                                await sock.sendMessage(from, { text: 'Invalid format. Use: DD/MM/YY, 10d, 5d, 1m, 2m, 1y, month=9, or month=9 year=25' });
                                return;
                            }
                            
                            const [, amount, unit] = periodMatch;
                            filteredTransactions = await transactionDao.getTransactionsByPeriod(detailsNumber, parseInt(amount), unit);
                            response += `Last ${amount}${unit.toUpperCase()} transactions:\n`;
                        }
                        
                        if (filteredTransactions.length === 0) {
                            response += 'No transactions found for this period.\n\n';
                        } else {
                            const periodTotal = filteredTransactions.reduce((sum, txn) => sum + txn.amount, 0);
                            response += `Total: ₹${periodTotal}\n\n`;
                            
                            filteredTransactions.forEach((txn, index) => {
                                response += `${index + 1}. ₹${txn.amount} on ${formatDate(txn.date)}`;
                                if (txn.details) {
                                    response += ` - ${txn.details}`;
                                }
                                response += '\n';
                            });
                        }
                        
                        // Add usage tip
                        response += '\n💡 Tip: Use 10d (days), 1m (months), 1y (years), month=9, or DD/MM/YY for specific periods';
                    } else {
                        const total = await transactionDao.getTotalSent(detailsNumber);
                        const lastTxn = await transactionDao.getLastTransaction(detailsNumber);

                        response += `Total Sent: ₹${total}`;
                        
                        if (lastTxn) {
                            response += `\nLast Sent: ₹${lastTxn.amount} on ${formatDate(lastTxn.date)}`;
                            if (lastTxn.details) {
                                response += ` - ${lastTxn.details}`;
                            }
                        } else {
                            response += `\nLast Sent: No transactions found`;
                        }
                        
                        response += '\n\n💡 Tip: Use 10d (days), 1m (months), 1y (years), month=9, or DD/MM/YY for specific periods';
                    }

                    await sock.sendMessage(from, { text: response });
                    break;

                case 'bill':
                    if (parts.length < 2) {
                        await sock.sendMessage(from, { text: 'Usage: bill <number> [DD/MM/YY] [10d/5d/1m/1y] [month=9] [month=9 year=25]' });
                        return;
                    }

                    const billNumber = parts[1];

                    if (!isValidNumber(billNumber)) {
                        await sock.sendMessage(from, { text: 'Invalid number format. Please use digits only.' });
                        return;
                    }

                    let billTransactions = [];
                    let billPeriodText = '';
                    let billTotal = 0;

                    if (parts.length >= 3) {
                        const remainingParts = parts.slice(2);
                        let param = remainingParts[0];
                        
                        // Check if it's a direct date format (DD/MM/YY or DD-MM-YY)
                        const directDate = parseDate(param);
                        if (directDate) {
                            billTransactions = await transactionDao.getTransactionsByDate(billNumber, directDate);
                            billPeriodText = `for ${formatDate(directDate.toISOString())}`;
                        }
                        // Check if it's date= format
                        else if (param.startsWith('date=')) {
                            const dateStr = param.substring(5);
                            const targetDate = parseDate(dateStr);
                            
                            if (!targetDate) {
                                await sock.sendMessage(from, { text: 'Invalid date format. Use DD/MM/YY, DD-MM-YY or DD/MM/YYYY' });
                                return;
                            }
                            
                            billTransactions = await transactionDao.getTransactionsByDate(billNumber, targetDate);
                            billPeriodText = `for ${formatDate(targetDate.toISOString())}`;
                        }
                        // Check if it's month= format
                        else if (param.startsWith('month=')) {
                            const monthStr = param.substring(6);
                            const month = parseInt(monthStr);
                            
                            if (isNaN(month) || month < 1 || month > 12) {
                                await sock.sendMessage(from, { text: 'Invalid month. Use month=1 to month=12' });
                                return;
                            }
                            
                            let year = null;
                            // Check if year is provided in next part
                            if (remainingParts.length > 1 && remainingParts[1].startsWith('year=')) {
                                const yearStr = remainingParts[1].substring(5);
                                year = parseInt(yearStr);
                                if (isNaN(year)) {
                                    await sock.sendMessage(from, { text: 'Invalid year format. Use year=25 or year=2025' });
                                    return;
                                }
                            }
                            
                            billTransactions = await transactionDao.getTransactionsByMonth(billNumber, month, year);
                            const yearText = year ? (year.toString().length === 2 ? `20${year}` : year.toString()) : new Date().getFullYear().toString();
                            billPeriodText = `for month ${month}/${yearText}`;
                        }
                        // Check if it's period format (10d, 5d, etc.)
                        else {
                            const periodMatch = param.match(/^(\d+)([dmy])$/i);
                            if (!periodMatch) {
                                await sock.sendMessage(from, { text: 'Invalid format. Use: DD/MM/YY, 10d, 5d, 1m, 2m, 1y, month=9, or month=9 year=25' });
                                return;
                            }
                            
                            const [, amount, unit] = periodMatch;
                            billTransactions = await transactionDao.getTransactionsByPeriod(billNumber, parseInt(amount), unit);
                            billPeriodText = `for last ${amount}${unit.toUpperCase()}`;
                        }
                        
                        billTotal = billTransactions.reduce((sum, txn) => sum + txn.amount, 0);
                    } else {
                        billTotal = await transactionDao.getTotalSent(billNumber);
                        billPeriodText = 'so far';
                    }
                    
                    if (billTotal === 0) {
                        await sock.sendMessage(from, { 
                            text: `No transactions found for ${billNumber}\n\n💡 Tip: Use 10d (days), 1m (months), 1y (years), month=9, or DD/MM/YY for specific periods` 
                        });
                        return;
                    }

                    const billRecipientJid = `91${billNumber}@s.whatsapp.net`;
                    await sock.sendMessage(billRecipientJid, { 
                        text: `Total amount received from Vipin Jangir ${billPeriodText}: ₹${billTotal}` 
                    });

                    await sock.sendMessage(from, { 
                        text: `✅ Sent bill summary (₹${billTotal}) ${billPeriodText} to ${billNumber}\n\n💡 Tip: Use 10d (days), 1m (months), 1y (years), month=9, or DD/MM/YY for specific periods` 
                    });
                    break;

                case 'help':
                case 'commands':
                    const helpText = `📋 *Available Commands & Formats*

🔹 *Send Money:*
• \`send <number> <amount>\` - Basic send
• \`send <number> <amount> details="info"\` - Send with details

🔹 *View Details:*
• \`details <number>\` - All transactions summary
• \`details <number> 12/08/25\` - Specific date (DD/MM/YY)
• \`details <number> 10d\` - Last 10 days
• \`details <number> 5d\` - Last 5 days  
• \`details <number> 1m\` - Last 1 month
• \`details <number> 2m\` - Last 2 months
• \`details <number> 1y\` - Last 1 year
• \`details <number> month=8\` - Current year, month 8
• \`details <number> month=8 year=25\` - Specific month/year

🔹 *Send Bills:*
• \`bill <number>\` - Total bill (all time)
• \`bill <number> 12/08/25\` - Bill for specific date
• \`bill <number> 30d\` - Last 30 days bill
• \`bill <number> 1m\` - Last 1 month bill
• \`bill <number> month=8\` - Current year, month 8
• \`bill <number> month=8 year=25\` - Specific month/year

🔹 *Help:*
• \`help\` or \`commands\` - Show this help

📝 *Date Formats Supported:*
• DD/MM/YY: 12/8/25, 01/02/25
• DD-MM-YY: 12-8-25, 01-02-25  
• DD/MM/YYYY: 12/08/2025

⏰ *Time Formats:*
• d = days (1d, 10d, 30d)
• m = months (1m, 2m, 6m)
• y = years (1y, 2y)

📞 *Examples:*
• \`send 9876543210 500 details="grocery payment"\`
• \`details 9876543210 10d\`
• \`bill 9876543210 month=8 year=25\``;

                    await sock.sendMessage(from, { text: helpText });
                    break;

                default:
                    await sock.sendMessage(from, { 
                        text: 'Type "help" or "commands" to see all available commands and formats.' 
                    });
                    break;
            }
        } catch (error) {
            console.error('Error processing command:', error);
            await sock.sendMessage(from, { 
                text: 'An error occurred while processing your command. Please try again.' 
            });
        }
    });

    return sock;
}

console.log('Starting WhatsApp Transactions Bot...');
console.log(`Authorized numbers: ${ALLOWED_NUMBERS.join(', ')}`);
console.log('Transactions will be stored in SQLite database');

startBot().catch(console.error);