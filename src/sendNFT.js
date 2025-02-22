// Import xrpl
const xrpl = require('xrpl');
// Import variables
const { seed, currency, currencyIssuer, sendingMemo, airdropAmounts } = require('../configNFT.json');
const fs = require('fs');
const moment = require('moment-timezone');

// Credentials for sending wallet from seed
const wallet = xrpl.Wallet.fromSeed(seed);

// Memo
const memo = Buffer.from(sendingMemo).toString('hex').toUpperCase();

// Delay function to avoid rate-limiting
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Function to log transaction details to a JSON file
const logTransaction = (transactionDetails, success = true) => {
    const filePath = success ? './transactions_success.json' : './transactions_failed.json';
    let transactions = [];

    // Read existing transactions from the file
    if (fs.existsSync(filePath)) {
        const data = fs.readFileSync(filePath);
        transactions = JSON.parse(data);
    }

    // Add the new transaction details
    transactions.push(transactionDetails);

    // Write the transactions back to the file
    fs.writeFileSync(filePath, JSON.stringify(transactions, null, 2));
};

// Function to send a single transaction
const sendTransaction = async (client, user, sequence, counter) => {
    let signed;
    try {
        // Prepare transaction
        const prepared = await client.autofill({
            TransactionType: "Payment",
            Account: wallet.address,
            Amount: {
                currency: currency,
                issuer: currencyIssuer,
                value: user.amount.toString(), // Airdrop amount per user
            },
            Destination: user.account,
            Sequence: sequence, // Explicitly set the sequence
            Memos: [
                {
                    Memo: {
                        MemoData: memo,
                    },
                },
            ],
        });

        // Prepared transaction information
        console.log(counter);
        console.log(
            `Prepared transaction: ${prepared.Account} is sending ${prepared.Amount.value} of ${prepared.Amount.currency} to ${prepared.Destination}`
        );
        console.log("Transaction cost:", xrpl.dropsToXrp(prepared.Fee), "XRP");

        // Sign the prepared instructions
        signed = wallet.sign(prepared);

        // Submit signed blob
        const result = await client.submitAndWait(signed.tx_blob);

        // Return transaction hash
        return { hash: signed.hash, user, counter, sequence, result };
    } catch (error) {
        console.error(`Error in send function for user ${user.account}:`, error.message);

        // Log error details to JSON file
        logTransaction({
            counter,
            account: user.account,
            amount: user.amount,
            transactionResult: 'ERROR',
            error: error.message,
            onChain: signed ? `https://xrpscan.com/tx/${signed.hash}` : 'N/A'
        }, false);

        return null;
    }
};

// Function to fetch transaction result from the ledger with retries
const fetchTransactionResult = async (client, tx, retries = 10) => {
    try {
        const result = await client.request({
            command: 'tx',
            transaction: tx.hash,
            binary: false
        });

        if (result.result && result.result.meta) {
            // Log transaction details to JSON file
            logTransaction({
                counter: tx.counter,
                account: tx.user.account,
                amount: tx.user.amount,
                transactionResult: result.result.meta.TransactionResult,
                onChain: `https://xrpscan.com/tx/${tx.hash}`,
                fee: xrpl.dropsToXrp(result.result.Fee),
            }, result.result.meta.TransactionResult === 'tesSUCCESS');
        } else {
            throw new Error('Transaction result not found');
        }
    } catch (error) {
        console.error(`Error fetching transaction result for ${tx.hash}:`, error);

        if (retries > 0) {
            console.log(`Retrying fetch transaction result for ${tx.hash}, retries left: ${retries}`);
            await delay(1000); // Reduced delay to 1 second before retrying
            return fetchTransactionResult(client, tx, retries - 1);
        } else {
            // Log error details to JSON file
            logTransaction({
                counter: tx.counter,
                account: tx.user.account,
                amount: tx.user.amount,
                transactionResult: 'ERROR',
                error: error.message,
                onChain: `https://xrpscan.com/tx/${tx.hash}`
            }, false);
        }
    }
};

// Main function
const send = async () => {
    // Read the snapshot file
    const snapshot = JSON.parse(fs.readFileSync('qualifiedWithTrustline_snapshot.json'));

    // Filter the user list to include only qualified users with trustline and ready for drop
    const userList = snapshot.holders.filter(holder => holder.readyForDrop).map(holder => ({
        account: holder.holderAddress,
        amount: airdropAmounts.find(({ trait_type, value }) => holder.nfts.some(nft => nft.trait_type === trait_type && nft.value === value)).amount,
        category: `${airdropAmounts.find(({ trait_type, value }) => holder.nfts.some(nft => nft.trait_type === trait_type && nft.value === value)).trait_type}-${airdropAmounts.find(({ trait_type, value }) => holder.nfts.some(nft => nft.trait_type === trait_type && nft.value === value)).value}`
    }));

    // Define the network client (keep a single connection for all transactions)
    const client = new xrpl.Client('wss://s1.ripple.com/');
    try {
        await client.connect();

        // Fetch account info to get the starting sequence
        const accountInfo = await client.request({
            command: "account_info",
            account: wallet.address,
        });

        let sequence = accountInfo.result.account_data.Sequence;

        // Check if the wallet has sufficient balance to cover the transactions
        const accountLines = await client.request({
            command: "account_lines",
            account: wallet.address,
            ledger_index: "current"
        });
        let balance = 0;
        for (const line of accountLines.result.lines) {
            if (line.currency === currency) balance = parseFloat(line.balance);
        }
        const totalAirdropAmount = userList.reduce((sum, user) => sum + user.amount, 0);
        if (balance < totalAirdropAmount) {
            console.log(`Insufficient balance to cover the airdrop. Available: ${balance}, Required: ${totalAirdropAmount}`);
            return;
        }

        // Store transaction hashes
        const transactions = [];

        // Send transactions one after the other without waiting for success
        for (let i = 0; i < userList.length; i++) {
            const user = userList[i];
            const counter = i + 1;
            const tx = await sendTransaction(client, user, sequence, counter);
            if (tx) {
                transactions.push(tx);
                sequence++;
            }
            await delay(500); // Reduced delay to speed up transactions
        }

        // Fetch transaction results
        for (const tx of transactions) {
            await fetchTransactionResult(client, tx);
            await delay(500); // Delay to avoid rate-limiting
        }

        // Separate successful and failed transactions
        const successfulTransactions = transactions.filter(tx => tx.result.result.meta.TransactionResult === 'tesSUCCESS');
        const failedTransactions = transactions.filter(tx => tx.result.result.meta.TransactionResult !== 'tesSUCCESS');

        // Get current time
        const currentTime = moment().tz("America/New_York").format("YYYY-MM-DD HH:mm:ss");

        // Write successful transactions to file
        const successfulOutput = {
            date: currentTime,
            transactions: successfulTransactions.map(tx => ({
                category: tx.user.category,
                account: tx.user.account,
                amount: tx.user.amount,
                transactionResult: tx.result.result.meta.TransactionResult,
                onChain: `https://xrpscan.com/tx/${tx.hash}`,
                fee: xrpl.dropsToXrp(tx.result.result.Fee)
            }))
        };
        fs.writeFileSync('./successfulTransactions.json', JSON.stringify(successfulOutput, null, 2));
        console.log('Successful transactions saved to successfulTransactions.json');

        // Write failed transactions to file
        const failedOutput = {
            date: currentTime,
            transactions: failedTransactions.map(tx => ({
                category: tx.user.category,
                account: tx.user.account,
                amount: tx.user.amount,
                transactionResult: tx.result.result.meta.TransactionResult,
                onChain: `https://xrpscan.com/tx/${tx.hash}`,
                fee: xrpl.dropsToXrp(tx.result.result.Fee)
            }))
        };
        fs.writeFileSync('./failedTransactions.json', JSON.stringify(failedOutput, null, 2));
        console.log('Failed transactions saved to failedTransactions.json');

    } catch (error) {
        console.error("Error during the airdrop process:", error.message);
    } finally {
        await client.disconnect(); // Ensure the client disconnects in case of an error
    }
};

module.exports = send;