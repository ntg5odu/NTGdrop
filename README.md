# Node.js slowDrop fork - NTGdrop Tool

An XRPL airdrop tool built with JavaScript and Node.js.

This tool carefully scans your holders and drops tokens to them while logging an on-ledger confirmation of each outgoing transaction.

**This tool is provided as is, use at you own discretion, modify at will. USE testMode:true until you understand what's going on**

This tool has a test/snapshot mode, that when set to "true", will scan the holders and give you a somewhat detailed snapshot of the accounts (especially for the NFT holders snapshots). It will have tags for the qualifying wallets, for better filtering.

**ALL CREDITS FOR THIS TOOL GO TO THE ORIGINAL CREATOR - CBOT**  
cbot on GitHub: [Cbot-XRPL](https://github.com/Cbot-XRPL)  
cbot on X: [Cbot_Xrpl](https://x.com/Cbot_Xrpl)

---

## Instructions

### 1. Download the project file.

### 2. Open in a code editor.
Use VSCode or any other code editor.

### 3. Run `npm install` in a terminal.
Open a new terminal, navigate to the **/NTGDrop** folder, and run `npm install` to install dependencies.

### 4. Configure each config.json file:

#### Base Config
- **seed**: The family-seed (s...) of the wallet you are sending from.

**WARNING**: If you modify this tool to share with other people, MAKE SURE TO DELETE YOUR FAMILY-SEED (PRIVATE KEYS) FROM **ALL** CONFIG.JSON FILES.  
**If your family-seed is compromised, you may lose all funds in the respective wallet. ALWAYS KEEP YOUR SECRET SAFE!!!**
- **issuer**: The issuing address of the token you are sending.
- **currency**: The currency code of the token you are sending.
- **testMode**: Boolean. Toggle between test/snapshot and airdrop mode with "true" or "false".
- **memo**: The memo you want on the airdrop transaction.
- **ignore wallets**: The holding wallets you want to ignore (as many as needed).

#### Specified Config

**config.json**  
This config drops a specified amount of tokens based on how many tokens one holds. You can create different categories. Use **airdropAmounts** with the following template: choose a "min" and "max" value that one must hold to qualify for the specific "amount" of tokens to drop. 

You can choose holders of any currency and check if they have the trustline for the token to be airdropped (any token you want, as long as you have them in the wallet to send).  In the config use "holdCurrency": for the currency code of the token holders you want to scan for & "holdIssuer": for the issuer. 

**If you want to send the same currency as you are scanning for, just make sure to use same currency code and issuer address for all categories( "currency": ,"issuer": ,"holdCurrency": ,"holdIssuer": ) in config**

**config2.json**  
This config is simple. Make a list of specific addresses you want to drop tokens to with **airdrop-list.json**, categorizing them by numbers/names (case-sensitive). Then, in the config2.json, specify the amount you want to drop to all addresses in each category using the "category" tag.
```json
"airdropAmounts": [
        {
            "category": 1,
            "amount": 0.00001
        },
        {
            "category": 2,
            "amount": 0.000001
        },
        {
            "category": 3,
            "amount": 0.0000001
        }
    ]
```

**airdrop-list.json**:
```json
{
    "1": [
        "rpLmG29H2QLyKaWdjwPFDwePgUAdtEea8p",
        "rAddress"
    ],
    "2": [
        "rKVVoAWU3kVZThTEL2HQ1JjjHKpbRcazkn"
    ],
    "3": [
        "rfwrPxKJ7DRTSaRZgnhAViYzNEnq6u6N2H"
    ]
}
```

**config3.json**  
This config works the same as **config.json**. It is adjusted to handle liquidity pool tokens. LP tokens might work with the config.json, but I think it is better to keep one for normal tokens and another for LP tokens for easier management.

**configNFT.json**  
This config handles xls-20 NFTs (previously xls-14). Use "nftIssuer": "rAddress" for the nftIssuer address. Put taxon number for the specific collection you want to scan for, use "listedAbove": 5.0 (price in XRP) to drop tokens for people who have the minimum amount of NFTs unlisted **AND/OR** listed above the specified value in the configNFT.json (keep "listedAbove":0 if you don't care if the NFT is listed or not). Use "min" & "max" to create categories for the amount of NFTs one must hold to qualify for each category. For example:
```json
"airdropAmounts": [
        {
            "min": 1,
            "max": 6,
            "amount": 0.00589
        },
        {
            "min": 7,
            "max": 8,
            "amount": 58985.8985
        }
]
```

**configNFTrait.json**  
This config can find specific traits in an NFT collection. Specify each trait_type and value to match the qualifying trait (case-sensitive). For example:
```json
"airdropAmounts": [
    {
        "trait_type": "hat",
        "value": "red",
        "amount": 0.00333
    },  
    {
        "trait_type": "uGa",
        "value": "BuGa",
        "amount": 0.00333
    }
]
```
Create as many categories as needed. If a holder has two or more qualifying traits, the code will sum them up and save it as totalAmount and that's what will be airdropped. It will all come out in the snapshot in detail (test first).

### 5. SNAPSHOTS/TEST/AIRDROP

In all config files, when "testMode" is set to true, you will have a set of .json files that will come out. Every time you rerun it, that json will be overwritten by another snapshot json. Some have more than one snapshot that comes out at once. For example:
In the NFTs, you'll have a json for non-qualified, a json for qualified but no trustline set up, and one for qualified with trustline. 

When "testMode" is set to false, regardless of the test snapshot, another snapshot will be made on top of it, but then after the airdrop will commence. **MAKE SURE TO LET TERMINAL/COMPUTER RUNNING UNTIL SCANNING/AIRDROP IS FINISHED AND TERMINAL CLOSES AUTOMATICALLY - DON'T LET COMPUTER SLEEP**. 
On top of that you'll also get a json for successful and one for failed transactions, with links to the XRPL explorer with the transactions.

**TIP - after you run the actual airdrop, save all snapshots and transaction lists in a separate folder for record keeping**

---

### 6. Index Files
**Make sure in the terminal, you are at /NGTdrop/src to initiate the program**

- **index.js**: Uses **config.json** for the setup. This index is for airdropping tokens based on specific token holding amounts.
  - To run: `node index.js`

- **index2.js**: Used for sending airdrops to a custom user list.
  - This file reads a list of wallet addresses from airdrop-list.json and sends airdrops to them. This is useful for targeting specific users rather than scanning the blockchain.
  - To run: `node index2.js`

- **index3.js**: Used for LP token holders.
  - This file is designed to scan for holders of LP (Liquidity Provider) tokens and send airdrops to them. It uses similar configurations as `index.js` but is tailored for LP tokens.
  - To run: `node index3.js`

- **indexNFT.js**: Used for NFT holders.
  - This file scans for holders of NFTs in a collection (taxon) with specified amounts of unlisted &/or listed above a certain price to qualify for an airdrop.
  - To run: `node indexNFT.js`

- **indexNFTrait.js**: Used for specific traits in an NFT.
  - This file allows you to target NFT holders based on specific traits. It scans the blockchain for NFTs with the specified traits and sends airdrops to their holders. If a holder has more than one qualifying NFT/trait, the drop value will be summed up to a totalValue which is then airdropped.
  - To run: `node indexNFTrait.js`

### END

**USAGE TIP - RUN TEST MODE ON EACH FILE TO HAVE A DETAILED LIST OF ADDRESSES AND SEE HOW THE SNAPSHOT COMES OUT**

**P-LIMIT - p-limit is used to speed up the scanning process but at the same time not overload the network with too many requests at once. DON'T INCREASE, SPEEDING PROCESS MORE THEN CURRENT SETTINGS MIGHT GET YOU RATE LIMITED AND AIRDROP MIGHT HAVE ERROR. For NFTs, P-limit must be 1, otherwise it won't scan all NFTs and you might have error**

**SAFETY TIP- USE A SEPARATE WALLET FOR AIRDROPS & ONLY LOAD YOUR AIRDROP WALLET WITH A CALCULATED AMOUNT OF TOKENS FOR AIRDROP**
