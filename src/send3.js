// Import xrpl
const xrpl = require('xrpl');
// Import variables
const { seed, currency, issuer, sendingMemo } = require('../config3.json');
const fs = require('fs');

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

  // Write the updated transactions back to the file
  fs.writeFileSync(filePath, JSON.stringify(transactions, null, 2));
};

// Function to send a single transaction
const sendTransaction = async (client, user, sequence, counter) => {
  let signed = null;
  try {
    if (!user || !user.account || !user.amount) {
      throw new Error('Invalid user object');
    }

    // Prepare transaction
    const prepared = await client.autofill({
      TransactionType: "Payment",
      Account: wallet.address,
      Amount: {
        currency: currency,
        issuer: issuer,
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
    await client.submit(signed.tx_blob);

    // Return transaction hash
    return { hash: signed.hash, user, counter, sequence };
  } catch (error) {
    console.error(`Error in send function for user ${user ? user.account : 'undefined'}:`, error.message);

    // Log error details to JSON file
    logTransaction({
      counter,
      account: user ? user.account : 'undefined',
      amount: user ? user.amount : 'undefined',
      transactionResult: 'ERROR',
      error: error.message,
      onChain: signed ? `https://mainnet.xrpl.org/transactions/${signed.hash}` : 'N/A'
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
        account: tx.user.account,
        amount: tx.user.amount,
        transactionResult: 'ERROR',
        error: error.message,
        onChain: `https://mainnet.xrpl.org/transactions/${tx.hash}`
      }, false);
    }
  }
};

// Main function
const send = async (userList) => {
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
  } finally {
    await client.disconnect(); // Ensure the client disconnects in case of an error
  }
};

module.exports = send;