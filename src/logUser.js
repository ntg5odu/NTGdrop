const fs = require('fs');
const path = './users.json';

// Function to log user information
const logUser = (account, transactionResult, sequence, onChain) => {
    let users = [];

    // Check if the file exists
    if (fs.existsSync(path)) {
        // Read existing users from the file
        const data = fs.readFileSync(path);
        users = JSON.parse(data);
    }

    // Add the new user information
    users.push({
        account,
        transactionResult,
        sequence,
        onChain
    });

    // Write the updated users back to the file
    fs.writeFileSync(path, JSON.stringify(users, null, 2));
};

module.exports = logUser;