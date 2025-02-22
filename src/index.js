// Import modules
const xrpl = require('xrpl');
const fs = require('fs');
const cliProgress = require('cli-progress');
const moment = require('moment-timezone');

// Import variables from config.json
const config = require('../config.json');
const { seed, currency, issuer, holdCurrency, holdIssuer, ignoreWallets, sendingMemo, testMode, airdropAmounts } = config;
const send = require('./send');

// Credentials for sending wallet from seed
const wallet = xrpl.Wallet.fromSeed(seed);

// Delay function to avoid rate-limiting
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const generateSnapshot = async () => {
    // Dynamic import for p-limit
    const pLimit = (await import('p-limit')).default;

    // Limit the number of concurrent requests
    const limit = pLimit(5); // Adjust the concurrency limit as needed

    let holders = [];
    // Get the token holders from the XRPL
    try {
        const client = new xrpl.Client('wss://s1.ripple.com/');
        await client.connect();
        let marker = null;
        do {
            const requestBody = {
                command: 'account_lines',
                account: holdIssuer,
                ledger_index: 'validated'
            };
            if (marker) {
                requestBody.marker = marker;
            }
            const response = await client.request(requestBody);
            holders = holders.concat(response.result.lines.filter(line => line.currency === holdCurrency && !ignoreWallets.includes(line.account) && Number(line.balance) !== 0).map(line => ({
                account: line.account,
                balance: Math.abs(Number(line.balance))
            })));
            marker = response.result.marker;
        } while (marker);
        await client.disconnect();
    } catch (error) {
        console.error(`Error getting token holders from the XRPL: ${error.message}`);
        return;
    }
    if (!holders.length) {
        console.log(`No holders found for the specified currency and issuer`);
        return;
    }

    console.log(`Found ${holders.length} holders for the specified currency and issuer`);

    // Progress bar setup
    const progressBar = new cliProgress.SingleBar({}, cliProgress.Presets.shades_classic);
    progressBar.start(holders.length, 0);

    // Check trustlines for qualified holders
    const client = new xrpl.Client('wss://s1.ripple.com/');
    await client.connect();
    const checkTrustlinePromises = holders.map(holder => limit(async () => {
        const hasTrustline = await retryCheckTrustline(holder.account, client);
        holder.hasTrustline = hasTrustline;
        holder.readyForDrop = holder.balance >= airdropAmounts[0].min && hasTrustline;
        progressBar.increment();
        await delay(100); // Add a small delay between requests to avoid rate-limiting
    }));
    await Promise.all(checkTrustlinePromises);
    progressBar.stop();
    await client.disconnect();

    // Prepare the JSON output in the desired format
    const qualifiedWithTrustline = [];
    const qualifiedWithoutTrustline = [];
    const nonQualifiedHolders = [];
    const currentTime = moment().tz("America/New_York").format("YYYY-MM-DD HH:mm:ss");

    holders.forEach(holder => {
        const balance = holder.balance;
        let isQualified = false;
        let totalAmount = 0;
        for (const { min, max, amount } of airdropAmounts) {
            if (balance >= min && balance <= max) {
                isQualified = true;
                totalAmount = amount;
                break;
            }
        }
        const holderData = {
            holderAddress: holder.account,
            heldTokens: balance,
            ignored: ignoreWallets.includes(holder.account),
            hasTrustline: holder.hasTrustline,
            readyForDrop: isQualified && holder.hasTrustline,
            isQualified: isQualified,
            totalAmount: totalAmount
        };
        if (holderData.readyForDrop) {
            qualifiedWithTrustline.push(holderData);
        } else if (holderData.isQualified) {
            qualifiedWithoutTrustline.push(holderData);
        } else {
            nonQualifiedHolders.push(holderData);
        }
    });

    // Save qualified holders with trustline to a JSON file
    const qualifiedWithTrustlineOutput = {
        date: currentTime,
        holders: qualifiedWithTrustline
    };
    fs.writeFileSync('qualifiedWithTrustline_snapshot.json', JSON.stringify(qualifiedWithTrustlineOutput, null, 2));
    console.log('Qualified with trustline snapshot saved to qualifiedWithTrustline_snapshot.json');

    // Save qualified holders without trustline to a JSON file
    const qualifiedWithoutTrustlineOutput = {
        date: currentTime,
        holders: qualifiedWithoutTrustline
    };
    fs.writeFileSync('qualifiedWithoutTrustline_snapshot.json', JSON.stringify(qualifiedWithoutTrustlineOutput, null, 2));
    console.log('Qualified without trustline snapshot saved to qualifiedWithoutTrustline_snapshot.json');

    // Save non-qualified holders to a JSON file
    const nonQualifiedOutput = {
        date: currentTime,
        holders: nonQualifiedHolders
    };
    fs.writeFileSync('nonQualified_snapshot.json', JSON.stringify(nonQualifiedOutput, null, 2));
    console.log('Non-qualified snapshot saved to nonQualified_snapshot.json');

    // If testMode is false, initiate the airdrop
    if (!testMode) {
        await send(qualifiedWithTrustline.map(holder => ({
            account: holder.holderAddress,
            amount: holder.totalAmount
        })));
    }
};

const retryCheckTrustline = async (wallet, client, retries = 3) => {
    try {
        return await checkTrustline(wallet, client);
    } catch (error) {
        if (retries > 0) {
            console.error(`Error checking trustline for ${wallet}, retrying... (${retries} retries left)`);
            await delay(1000); // Wait for 1 second before retrying
            return retryCheckTrustline(wallet, client, retries - 1);
        } else {
            console.error(`Error checking trustline for ${wallet}:`, error.message);
            return false;
        }
    }
};

const checkTrustline = async (wallet, client) => {
    try {
        if (client.isConnected()) {
            const response = await client.request({
                command: "account_lines",
                account: wallet,
                ledger_index: "current"
            });
            if (response.result.lines.length < 1) return false;
            for (const line of response.result.lines) {
                if (line.currency === currency && line.account === issuer) return true;
            }
            return false;
        } else {
            throw new Error('WebSocket is not open');
        }
    } catch (error) {
        console.error(`Error checking trustline for ${wallet}:`, error.message);
        throw error;
    }
};

generateSnapshot();