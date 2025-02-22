// Import modules
const xrpl = require('xrpl');
const axios = require('axios');
const fs = require('fs');
const cliProgress = require('cli-progress');
const moment = require('moment-timezone');

// Import variables from configNFTrait.json
const config = require('../configNFTrait.json');
const { seed, nftIssuer, taxon, testMode, sendingMemo, airdropAmounts, ignoreWallets, currency, currencyIssuer } = config;
const sendAirdrop = require('./sendNFTrait.js');

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
        nfts: [],
        hasTrustline: hasTrustline,
        totalAmount: 0
      };
      holderCount++;
    }
    holders[n.Owner].totalNFTs += 1;
    const uriHex = n.URI;
    if (typeof uriHex !== 'string' || !/^[0-9a-fA-F]+$/.test(uriHex)) {
      console.error(`Invalid URI hex for NFT with ID ${n.NFTokenID}: ${uriHex}`);
      continue;
    }
    let uri;
    try {
      uri = Buffer.from(uriHex, 'hex').toString('utf8');
    } catch (error) {
      console.error(`Error decoding URI hex for NFT with ID ${n.NFTokenID}: ${uriHex}`);
      continue;
    }
    if (!uri.startsWith('ipfs://')) {
      console.error(`Invalid URI format for NFT with ID ${n.NFTokenID}: ${uri}`);
      continue;
    }
    const ipfsUrl = uri.replace('ipfs://', 'https://ipfs.io/ipfs/');
    console.log(`Fetched URI for NFT with ID ${n.NFTokenID}: ${ipfsUrl}`);
    const nftAttributes = await getNftAttributes(ipfsUrl);
    if (!nftAttributes.attributes) {
      console.error(`No attributes found for NFT with URI ${ipfsUrl}`);
      continue;
    }
    const qualifiedTraits = airdropAmounts.filter(({ trait_type, value }) =>
      nftAttributes.attributes.some(attr => attr.trait_type === trait_type && attr.value === value)
    );
    const totalAmount = qualifiedTraits.reduce((sum, trait) => sum + trait.amount, 0);
    holders[n.Owner].totalAmount += totalAmount;
    holders[n.Owner].nfts.push({

      Issuer: n.Issuer,
      NFTokenID: n.NFTokenID,
      NFTokenTaxon: n.NFTokenTaxon,
      Royalties: (n.TransferFee / 1000).toFixed(2) + ' %', // Correctly convert to percentage
      URI: ipfsUrl,
      nft_serial: n.sequence,
      bithompLink: `https://bithomp.com/en/nft/${n.NFTokenID}`,
      schema: nftAttributes.schema,
      nftType: nftAttributes.nftType,
      name: nftAttributes.name,

      collection: nftAttributes.collection,
      attributes: nftAttributes.attributes,
      license: nftAttributes.license,
      trait_type: qualifiedTraits.length > 0 ? qualifiedTraits[0].trait_type : null,
      value: qualifiedTraits.length > 0 ? qualifiedTraits[0].value : null,
      amount: totalAmount,
      qualifiedTraits,
      qualified: totalAmount > 0 && holders[n.Owner].hasTrustline
    });
    progressBar.increment();
    await delay(100); // Add a delay between requests to avoid rate-limiting
  }
  progressBar.stop();
  console.log(`There are ${holderCount} holders of NFTs in the collection (After Blacklist and no TrustLine removals)`);

  // Prepare the JSON output in the desired format
  const qualifiedWithTrustline = [];
  const qualifiedWithoutTrustline = [];
  const nonQualifiedHolders = [];
  const currentTime = moment().tz("America/New_York").format("YYYY-MM-DD HH:mm:ss");

  Object.values(holders).forEach(holder => {
    if (holder.totalAmount > 0) {
      if (holder.hasTrustline) {
        qualifiedWithTrustline.push({
          holderAddress: holder.wallet,
          totalNFTs: holder.totalNFTs,
          ignored: ignoreWallets.includes(holder.wallet),
          hasTrustline: holder.hasTrustline,
          readyForDrop: true,
          isQualified: true,
          totalAmount: holder.totalAmount,
          nfts: holder.nfts
        });
      } else {
        qualifiedWithoutTrustline.push({
          holderAddress: holder.wallet,
          totalNFTs: holder.totalNFTs,
          ignored: ignoreWallets.includes(holder.wallet),
          hasTrustline: holder.hasTrustline,
          readyForDrop: false,
          isQualified: true,
          totalAmount: holder.totalAmount,
          nfts: holder.nfts
        });
      }
    } else {
      nonQualifiedHolders.push({
        holderAddress: holder.wallet,
        totalNFTs: holder.totalNFTs,
        ignored: ignoreWallets.includes(holder.wallet),
        hasTrustline: holder.hasTrustline,
        isQualified: false,
        totalAmount: holder.totalAmount
      });
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

  // Ensure the WebSocket connection is closed
  await client.disconnect();

  // If testMode is false, initiate the airdrop
  if (!testMode) {
    await sendAirdrop(qualifiedWithTrustline.filter(holder => !holder.ignored));
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

const getNftAttributes = async (ipfsUrl) => {
  try {
    console.log(`Fetching NFT attributes for IPFS URL: ${ipfsUrl}`);
    const fetch = (await import('node-fetch')).default;
    const response = await fetch(ipfsUrl);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const data = await response.json();
    return data;
  } catch (error) {
    console.error(`Error fetching NFT attributes for IPFS URL ${ipfsUrl}: ${error.message}`);
    return {};
  }
};

generateSnapshot();