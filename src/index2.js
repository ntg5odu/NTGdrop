// Import modules
const xrpl = require('xrpl');
const send = require('./send2');
const fs = require('fs');
// Import variables
const { seed, currency, testMode, issuer, airdropListFile, sendingMemo, airdropAmounts } = require('../config2.json');

// Credentials for sending wallet from seed
const wallet = xrpl.Wallet.fromSeed(seed);

// Delay function to avoid rate-limiting
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Start holder array
let counter = 0;

const main = async () => {
  fs.readFile(airdropListFile, 'utf8', async (err, data) => {
    if (err) {
      console.log(`Error reading file from disk: ${err}`);
    } else {
      // Parse JSON database to JavaScript object
      const database = JSON.parse(data);

      // Establish connection to XRPL
      const client = new xrpl.Client('wss://s1.ripple.com/');
      await client.connect();

      if (testMode) {
        // Test mode: generate snapshot list
        const snapshot = [];

        for (const category in database) {
          const addresses = database[category];
          const amount = airdropAmounts.find(a => a.category.toString() === category).amount;

          addresses.forEach(account => {
            snapshot.push({
              account,
              category,
              amount,
              currency,
              ticker: 'NTg5ODU=', // Replace with actual ticker if available
              bithompLink: `https://bithomp.com/en/account/${account}`
            });
          });
        }

        // Save snapshot to JSON file
        fs.writeFileSync('snapshot_index2.json', JSON.stringify(snapshot, null, 2));
        console.log('Snapshot saved to snapshot_index2.json');
      } else {
        // Process each holder in the database
        const transactions = [];

        for (const category in database) {
          const addresses = database[category];
          const amount = airdropAmounts.find(a => a.category.toString() === category).amount;

          for (const account of addresses) {
            counter++;

            // Log holder information
            console.log(account, `counter: ${counter}`);

            // Prepare holder object
            const holder = {
              account,
              amount
            };

            // Send airdrop
            const tx = await sendTransaction(client, holder, counter);
            if (tx) {
              transactions.push(tx);
            }

            // Add a delay between transactions
            await delay(500);
          }
        }

        // Fetch transaction results
        for (const tx of transactions) {
          await fetchTransactionResult(client, tx);
          await delay(500); // Delay to avoid rate-limiting
        }
      }

      // Disconnect from XRPL
      await client.disconnect();
    }
  });
};

// Function to send a single transaction
const sendTransaction = async (client, holder, counter) => {
  try {
    // Prepare transaction
    const prepared = await client.autofill({
      TransactionType: "Payment",
      Account: wallet.address,
      Amount: {
        currency: currency,
        issuer: issuer,
        value: holder.amount.toString(), // Airdrop amount per user
      },
      Destination: holder.account,
      Memos: [
        {
          Memo: {
            MemoData: Buffer.from(sendingMemo).toString('hex').toUpperCase(),
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
    const signed = wallet.sign(prepared);

    // Submit signed blob
    await client.submit(signed.tx_blob);

    // Return transaction hash
    return { hash: signed.hash, holder, counter };
  } catch (error) {
    console.error(`Error in send function for user ${holder.account}:`, error.message);

    // Log error details to JSON file
    logTransaction({
      counter,
      account: holder.account,
      amount: holder.amount,
      transactionResult: 'ERROR',
      error: error.message,
      onChain: `https://mainnet.xrpl.org/transactions/${signed.hash}`
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
        account: tx.holder.account,
        amount: tx.holder.amount,
        transactionResult: result.result.meta.TransactionResult,
        onChain: `https://mainnet.xrpl.org/transactions/${tx.hash}`,
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
        account: tx.holder.account,
        amount: tx.holder.amount,
        transactionResult: 'ERROR',
        error: error.message,
        onChain: `https://mainnet.xrpl.org/transactions/${tx.hash}`
      }, false);
    }
  }
};

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

  // Write the updated transactions back to the file
  fs.writeFileSync(filePath, JSON.stringify(transactions, null, 2));
};

main();