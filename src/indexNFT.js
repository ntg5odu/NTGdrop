// Import modules
const xrpl = require('xrpl');
const axios = require('axios');
const fs = require('fs');
const cliProgress = require('cli-progress');
const moment = require('moment-timezone');

// Import variables from configNFT.json
const config = require('../configNFT.json');
const { seed, nftIssuer, taxon, testMode, sendingMemo, airdropAmounts, ignoreWallets, currency, currencyIssuer, listedAbove } = config;
const send = require('./sendNFT.js');

// Credentials for sending wallet from seed
const wallet = xrpl.Wallet.fromSeed(seed);

// Delay function to avoid rate-limiting
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const generateSnapshot = async () => {
  let data = null;
  // Get the NFTs from the XRPL Services API
  try {
    const response = await axios.get(`https://api.xrpldata.com/api/v1/xls20-nfts/issuer/${nftIssuer}/taxon/${taxon}`);
    data = response.data.data;
  } catch (error) {
    console.log(`There was an error getting that collection information from the XRPL Services API`);
    return;
  }
  if (!data || !data.nfts.length) {
    console.log(`There are no NFTs in that collection`);
    return;
  }
  // Iterate through the NFTs and get the holders and the amount they hold
  const nfts = data.nfts;
  console.log(`There are ${nfts.length} NFTs in the collection`);
  let holders = {};
  let holderCount = 0;
  let checked = [];

  // Get wallet from provided Seed and connect to XRPL
  const client = new xrpl.Client('wss://s1.ripple.com/');
  await client.connect();

  // Progress bar setup
  const progressBar = new cliProgress.SingleBar({}, cliProgress.Presets.shades_classic);
  progressBar.start(nfts.length, 0);

  for (const n of nfts) {
    if (!holders[n.Owner]) {
      if (checked.includes(n.Owner)) continue;
      checked.push(n.Owner);
      const hasTrustline = await checkTrustline(n.Owner, client);
      holders[n.Owner] = {
        wallet: n.Owner,
        totalNFTs: 0,
        totalListed: 0,
        totalListedUnder: 0,
        totalListedAbove: 0,
        totalUnlisted: 0,
        nfts: [],
        hasTrustline: hasTrustline
      };
      holderCount++;
    }
    holders[n.Owner].totalNFTs += 1;
    const { listed, price } = await isNftListedForSale(client, n.NFTokenID);
    const listedAboveValue = listed && parseFloat(price / 1000000) >= listedAbove;
    holders[n.Owner].nfts.push({
      Flags: n.Flags,
      Issuer: n.Issuer,
      NFTokenID: n.NFTokenID,
      NFTokenTaxon: n.NFTokenTaxon,
      Royalties: (n.TransferFee / 1000).toFixed(2) + ' %', // Correctly convert to percentage
      URI: n.URI,
      nft_serial: n.nft_serial,
      bithompLink: `https://bithomp.com/en/nft/${n.NFTokenID}`,
      isListed: listed,
      listedPrice: listed ? (price / 1000000).toFixed(6) + ' XRP' : null,
      currentConfigPrice: listedAbove,
      listedAbove: listedAboveValue,
      qualified: !listed || listedAboveValue
    });
    if (listed) {
      holders[n.Owner].totalListed += 1;
      if (listedAboveValue) {
        holders[n.Owner].totalListedAbove += 1;
      } else {
        holders[n.Owner].totalListedUnder += 1;
      }
    } else {
      holders[n.Owner].totalUnlisted += 1;
    }
    progressBar.increment();
    await delay(100); // Add a delay between requests to avoid rate-limiting
  }
  progressBar.stop();
  console.log(`There are ${holderCount} holders of NFTs in the collection (After Blacklist and no TrustLine removals)`);

  // Prepare the JSON output in the desired format
  const summaryQualifiedWithTrustline = {};
  const summaryQualifiedWithoutTrustline = {};
  const qualifiedWithTrustline = [];
  const qualifiedWithoutTrustline = [];
  const nonQualifiedHolders = [];
  const currentTime = moment().tz("America/New_York").format("YYYY-MM-DD HH:mm:ss");

  Object.values(holders).forEach(holder => {
    const totalCount = holder.totalUnlisted + holder.totalListedAbove;
    let isQualified = false;
    let category = null;
    for (const { min, max } of airdropAmounts) {
      if (totalCount >= min && totalCount <= max) {
        isQualified = true;
        category = `${min}-${max}`;
        break;
      }
    }
    if (isQualified) {
      if (holder.hasTrustline) {
        if (!summaryQualifiedWithTrustline[category]) summaryQualifiedWithTrustline[category] = 0;
        summaryQualifiedWithTrustline[category]++;
        qualifiedWithTrustline.push({
          holderAddress: holder.wallet,
          totalNFTs: holder.totalNFTs,
          totalListed: holder.totalListed,
          totalListedUnder: holder.totalListedUnder,
          totalListedAbove: holder.totalListedAbove,
          totalUnlisted: holder.totalUnlisted,
          nfts: holder.nfts,
          ignored: ignoreWallets.includes(holder.wallet),
          hasTrustline: holder.hasTrustline,
          readyForDrop: true,
          isQualified: isQualified
        });
      } else {
        if (!summaryQualifiedWithoutTrustline[category]) summaryQualifiedWithoutTrustline[category] = 0;
        summaryQualifiedWithoutTrustline[category]++;
        qualifiedWithoutTrustline.push({
          holderAddress: holder.wallet,
          totalNFTs: holder.totalNFTs,
          totalListed: holder.totalListed,
          totalListedUnder: holder.totalListedUnder,
          totalListedAbove: holder.totalListedAbove,
          totalUnlisted: holder.totalUnlisted,
          nfts: holder.nfts,
          ignored: ignoreWallets.includes(holder.wallet),
          hasTrustline: holder.hasTrustline,
          readyForDrop: false,
          isQualified: isQualified
        });
      }
    } else {
      nonQualifiedHolders.push({
        holderAddress: holder.wallet,
        totalNFTs: holder.totalNFTs,
        totalListed: holder.totalListed,
        totalListedUnder: holder.totalListedUnder,
        totalListedAbove: holder.totalListedAbove,
        totalUnlisted: holder.totalUnlisted,
        nfts: holder.nfts,
        ignored: ignoreWallets.includes(holder.wallet),
        hasTrustline: holder.hasTrustline,
        isQualified: isQualified
      });
    }
  });

  // Save qualified holders with trustline to a JSON file
  const qualifiedWithTrustlineOutput = {
    date: currentTime,
    summaryQualifiedWithTrustline,
    holders: qualifiedWithTrustline
  };
  fs.writeFileSync('qualifiedWithTrustline_snapshot.json', JSON.stringify(qualifiedWithTrustlineOutput, null, 2));
  console.log('Qualified with trustline snapshot saved to qualifiedWithTrustline_snapshot.json');

  // Save qualified holders without trustline to a JSON file
  const qualifiedWithoutTrustlineOutput = {
    date: currentTime,
    summaryQualifiedWithoutTrustline,
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

  // Ensure the WebSocket connection is closed
  await client.disconnect();

  // If testMode is false, initiate the airdrop
  if (!testMode) {
    await sendAirdrop(qualifiedWithTrustline);
  }
};

const checkTrustline = async (wallet, client) => {
  try {
    const response = await client.request({
      command: "account_lines",
      account: wallet,
      ledger_index: "current"
    });
    if (response.result.lines.length < 1) return false;
    for (const line of response.result.lines) {
      if (line.currency === currency) return true;
    }
    return false;
  } catch (error) {
    console.error(`Error checking trustline for ${wallet}:`, error.message);
    return false;
  }
};

const isNftListedForSale = async (client, nftId, retries = 3) => {
  try {
    const response = await client.request({
      command: 'nft_sell_offers',
      nft_id: nftId,
      ledger_index: 'validated'
    });
    if (response.result.offers && response.result.offers.length > 0) {
      const offer = response.result.offers[0];
      return { listed: true, price: Number(offer.amount) };
    }
    return { listed: false, price: 0 };
  } catch (error) {
    if (error.data && error.data.error === 'objectNotFound') {
      return { listed: false, price: 0 };
    }
    if (retries > 0) {
      console.error('Error checking NFT sell offers, retrying:', error.message);
      await delay(1000); // Wait for 1 second before retrying
      return isNftListedForSale(client, nftId, retries - 1);
    }
    console.error('Error checking NFT sell offers:', error);
    return { listed: false, price: 0 };
  }
};

const sendAirdrop = async (qualifiedHolders) => {
  const client = new xrpl.Client('wss://s1.ripple.com/');
  await client.connect();

  const successfulTransactions = [];
  const failedTransactions = [];
  const currentTime = moment().tz("America/New_York").format("YYYY-MM-DD HH:mm:ss");

  for (const holder of qualifiedHolders) {
    const category = airdropAmounts.find(({ min, max }) => holder.totalNFTs >= min && holder.totalNFTs <= max);
    if (!category) continue;

    const transaction = {
      TransactionType: "Payment",
      Account: wallet.address,
      Amount: {
        currency: currency,
        issuer: currencyIssuer,
        value: category.amount.toString()
      },
      Destination: holder.holderAddress,
      Memos: [
        {
          Memo: {
            MemoData: Buffer.from(sendingMemo).toString('hex').toUpperCase()
          }
        }
      ]
    };

    try {
      const prepared = await client.autofill(transaction);
      const signed = wallet.sign(prepared);
      const result = await client.submitAndWait(signed.tx_blob);

      if (result.result.meta.TransactionResult === "tesSUCCESS") {
        successfulTransactions.push({
          category: `${category.min}-${category.max}`,
          account: holder.holderAddress,
          amount: category.amount,
          transactionResult: result.result.meta.TransactionResult,
          onChain: `https://xrpscan.com/tx/${signed.hash}`,
          fee: xrpl.dropsToXrp(result.result.Fee)
        });
      } else {
        failedTransactions.push({
          category: `${category.min}-${category.max}`,
          account: holder.holderAddress,
          amount: category.amount,
          transactionResult: result.result.meta.TransactionResult,
          onChain: `https://xrpscan.com/tx/${signed.hash}`,
          fee: xrpl.dropsToXrp(result.result.Fee)
        });
      }
    } catch (error) {
      failedTransactions.push({
        category: `${category.min}-${category.max}`,
        account: holder.holderAddress,
        amount: category.amount,
        transactionResult: "error",
        error: error.message
      });
    }
  }

  // Save successful transactions to a JSON file
  const successfulOutput = {
    date: currentTime,
    transactions: successfulTransactions
  };
  fs.writeFileSync('successfulTransactions.json', JSON.stringify(successfulOutput, null, 2));
  console.log('Successful transactions saved to successfulTransactions.json');

  // Save failed transactions to a JSON file
  const failedOutput = {
    date: currentTime,
    transactions: failedTransactions
  };
  fs.writeFileSync('failedTransactions.json', JSON.stringify(failedOutput, null, 2));
  console.log('Failed transactions saved to failedTransactions.json');

  await client.disconnect();
};

generateSnapshot();