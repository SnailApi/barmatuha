import { readFileSync, writeFileSync } from "fs";
import { queue, forEachLimit } from "async";
import ethers from "ethers";
import Web3 from "web3";
import * as dotenv from "dotenv";
dotenv.config();

import { CLAIM_ABI, ARB_ABI } from "./abi.mjs";

const web3 = new Web3(process.env.RPC);
const CLAIM_ADDRESS = "0x67a24CE4321aB3aF51c2D0a4801c3E111D88C9d9";
const CLAIM_CONTRACT = new web3.eth.Contract(CLAIM_ABI, CLAIM_ADDRESS);

const BARMATUHA_ADDRESS = "0xfc5a1a6eb076a2c7ad06ed22c90d7e710e35ad0a";
const BARMATUHA_CONTRACT = new web3.eth.Contract(ARB_ABI, BARMATUHA_ADDRESS);

const claim_call = async (item) => {
    const query = CLAIM_CONTRACT.methods.claim();

    const tx = {
        type: 2,
        to: CLAIM_ADDRESS,
        data: query.encodeABI(),
        // maxFeePerGas: web3.utils.toWei("0.135", "gwei"),
        // maxPriorityFeePerGas: "0x0",
    };
    tx.gas = await web3.eth.estimateGas(tx);
    const signed = await web3.eth.accounts.signTransaction(tx, item.private_key);
    await web3.eth.sendSignedTransaction(signed.rawTransaction);
};

const transfer_to = async (item, to_transfer, transfer_to) => {
    const query = BARMATUHA_CONTRACT.methods.transfer(transfer_to, to_transfer);

    const tx = {
        type: 2,
        from: item.address,
        to: BARMATUHA_ADDRESS,
        data: query.encodeABI(),
        // maxFeePerGas: web3.utils.toWei("0.135", "gwei"),
        // maxPriorityFeePerGas: "0x0",
    };
    tx.gas = await web3.eth.estimateGas(tx);
    const signed = await web3.eth.accounts.signTransaction(tx, item.private_key);
    await web3.eth.sendSignedTransaction(signed.rawTransaction);
};

const mass_claimer = async (wallet_state, wallets, async_events) => {
    let info = {
        claimed: 0,
        transfered: 0,
        claim_error: 0,
        transfer_error: 0,
    };
    return new Promise((resolve) => {
        forEachLimit(
            wallets,
            async_events,
            async (item) => {
                if (!item.claimed) {
                    try {
                        await claim_call(item);
                        console.log(`::INFO CLAIMED: ${item.address}`);
                        info.claimed += 1;
                        item.claimed = true;
                        wallet_state.push("");
                    } catch (e) {
                        console.log(`::ERROR NOT CLAIMED: ${item.address} ${e.message}`);
                        info.claim_error += 1;
                    }
                }
                if (!item.transfered && item.claimed && item.transfer_to) {
                    const balance = await BARMATUHA_CONTRACT.methods.balanceOf(item.address).call();
                    const human_balance = parseFloat(ethers.utils.formatEther(balance));
                    const to_transfer = ethers.utils.parseEther(`${human_balance - human_balance * 0.015}`);

                    try {
                        await transfer_to(item, to_transfer, item.transfer_to);
                        info.transfered += 1;
                        item.transfered = true;
                        wallet_state.push("");
                        console.log(
                            `::INFO TRANSFER COMPLETED: ${item.address} -> ${item.transfer_to} ${parseFloat(ethers.utils.formatEther(to_transfer))}`,
                        );
                    } catch (e) {
                        console.log(`::ERROR TRANSFER: ${item.address} ${e.message}`);
                        info.transfer_error += 1;
                    }
                }
            },
            (e) => {
                if (e) {
                    console.log(e);
                }
                resolve(info);
            },
        );
    });
};

const claim_info = async (wallet_state, wallets) => {
    return new Promise((resolve) => {
        forEachLimit(
            wallets,
            5,
            async (item) => {
                const BARMATUHA = await CLAIM_CONTRACT.methods.claimableTokens(item.address).call();
                const human_BARMATUHA = parseFloat(ethers.utils.formatEther(BARMATUHA));
                item.claimable = human_BARMATUHA;
                wallet_state.push("");
                console.log(item.address, human_BARMATUHA);
            },
            (e) => {
                if (e) {
                    console.log(e);
                }
                resolve();
            },
        );
    });
};

(async () => {
    const task = process.argv[2];
    const async_events = process.argv[3] || 30;
    const WALLET_PATH = "wallets.json";
    const WALLETS = JSON.parse(readFileSync(WALLET_PATH, "utf-8"));

    const save_wallet_state = queue((_, cb) => {
        writeFileSync(WALLET_PATH, JSON.stringify(WALLETS));
        cb(null);
    }, 1);

    switch (task) {
        case "import":
            {
                const new_keys = readFileSync("keys", "utf-8").split("\n");
                let imported = 0;
                for (const private_key of new_keys) {
                    if (JSON.stringify(WALLETS).indexOf(private_key.toLowerCase()) === -1) {
                        const wallet = new ethers.Wallet(private_key);
                        WALLETS.push({
                            private_key,
                            address: wallet.address,
                            claimed: false,
                            transfered: false,
                            transfer_to: "",
                        });
                        imported += 1;
                    }
                }
                writeFileSync(WALLET_PATH, JSON.stringify(WALLETS));
                console.log(`::INFO IMPORT COMPLETED: ${imported}`);
            }
            break;
        case "claim":
            {
                try {
                    console.log(`::INFO CLAIM STARTED`);
                    const info = await mass_claimer(save_wallet_state, WALLETS, async_events);
                    console.log(`::INFO CLAIM COMPLETED: ${JSON.stringify(info)}`);
                } catch (e) {
                    console.log(`::ERROR WHILE CLAIME: ${e.message}`);
                }
            }
            break;
        case "info":
            {
                try {
                    console.log(`::INFO CLAIM INFO STARTED`);
                    await claim_info(save_wallet_state, WALLETS);
                    console.log(`::INFO CLAIM INFO UPDATED`);
                } catch (e) {
                    console.log(`::ERROR CLAIM INFO: ${e.message}`);
                }
            }
            break;
        case "set-cex":
            {
                console.log(`::INFO START SET DEX ADDRESSES`);
                const dex_deposit_addresses = readFileSync("cex", "utf-8").split("\n");
                let set = 0;
                for (let item of WALLETS) {
                    if (!item.transfer_to) {
                        for (const transfer_to of dex_deposit_addresses) {
                            if (JSON.stringify(WALLETS).indexOf(transfer_to.toLowerCase()) === -1) {
                                item.transfer_to = transfer_to;
                                console.log(item.address, item.transfer_to);
                                set += 1;
                                break;
                            }
                        }
                    } else {
                        if (item.transfer_to) {
                            console.log(item.address, "->", item.transfer_to, item.claimable);
                        }
                    }
                }
                writeFileSync(WALLET_PATH, JSON.stringify(WALLETS));
                console.log(`::INFO TOTAL SET DEX ADDRESSES: ${set}`);
            }
            break;
        default:
            console.log(`::ERROR NO SUCH COMMAND`);
            break;
    }
})();