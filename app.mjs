import { readFileSync, writeFileSync } from "fs";
import { queue, forEachLimit } from "async";
import ethers from "ethers";
import Web3 from "web3";
import * as dotenv from "dotenv";
dotenv.config();

import { CLAIM_ABI, ARB_ABI, MULTICALL_ABI } from "./abi.mjs";

const web3 = new Web3(process.env.RPC);
const CLAIM_ADDRESS = "0x67a24CE4321aB3aF51c2D0a4801c3E111D88C9d9";
const CLAIM_CONTRACT = new web3.eth.Contract(CLAIM_ABI, CLAIM_ADDRESS);

const BARMATUHA_ADDRESS = "0x912ce59144191c1204e64559fe8253a0e49e6548";
const BARMATUHA_CONTRACT = new web3.eth.Contract(ARB_ABI, BARMATUHA_ADDRESS);

const MULTICALL_ADDRESS = "0x842eC2c7D803033Edf55E478F461FC547Bc54EB2";
const MULTICALL_CONTRACT = new web3.eth.Contract(MULTICALL_ABI, MULTICALL_ADDRESS);

const CLAIM_START = 16890400;

const claim_call = async (item) => {
    const query = CLAIM_CONTRACT.methods.claim();

    const tx = {
        //type: 2,
        to: CLAIM_ADDRESS,
        data: query.encodeABI(),
        // maxFeePerGas: web3.utils.toWei("0.135", "gwei"),
        // maxPriorityFeePerGas: "0x0",
        gasPrice: (await web3.eth.getGasPrice()) * 1.2,
    };
    tx.gas = 1000000; //await web3.eth.estimateGas(tx);
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
                    while (true) {
                        try {
                            const BARMATUHA2 = await CLAIM_CONTRACT.methods.claimableTokens(item.address).call();
                            if (!BARMATUHA2) {
                                console.log(`::INFO CLAIMED: ${item.address}`);
                                info.claimed += 1;
                                item.claimed = true;
                                wallet_state.push("");
                                break;
                            }
                            await claim_call(item);
                            console.log(`::INFO CLAIMED: ${item.address}`);
                            info.claimed += 1;
                            item.claimed = true;
                            wallet_state.push("");
                            break;
                        } catch (e) {
                            console.log(`::ERROR NOT CLAIMED: ${item.address} ${e.message}`);
                            info.claim_error += 1;
                            if (e.message.indexOf("TokenDistributor: claim not started") > -1) {
                                continue;
                            } else {
                                break;
                            }
                        }
                    }
                }
                const BARMATUHA = await CLAIM_CONTRACT.methods.claimableTokens(item.address).call();
                const BARMATUHA_BALANCE = await BARMATUHA_CONTRACT.methods.balanceOf(item.address).call();

                if (BARMATUHA_BALANCE && item.transfer_to && item.claimable) {
                    //const human_balance = parseFloat(ethers.utils.formatEther(balance));
                    //const to_transfer = ethers.utils.parseEther(`${human_balance - human_balance * 0.015}`);

                    try {
                        await transfer_to(item, BARMATUHA_BALANCE, item.transfer_to);
                        info.transfered += 1;
                        item.transfered = true;
                        wallet_state.push("");
                        console.log(
                            `::INFO TRANSFER COMPLETED: ${item.address} -> ${item.transfer_to} ${parseFloat(
                                ethers.utils.formatEther(BARMATUHA_BALANCE),
                            )}`,
                        );
                    } catch (e) {
                        console.log(`::ERROR TRANSFER: ${item.address} ${e.message}`);
                        info.transfer_error += 1;
                    }
                } else {
                    if (BARMATUHA > 0) {
                        console.log(
                            `::WARNING CLAIM NOT COMPLETED TRY AGAIN! LEFT TO CLAIM: ${item.address} -> ${parseFloat(
                                ethers.utils.formatEther(BARMATUHA),
                            )}`,
                        );
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
            1000,
            async (item) => {
                const BARMATUHA = await CLAIM_CONTRACT.methods.claimableTokens(item.address).call();
                const human_BARMATUHA = parseFloat(ethers.utils.formatEther(BARMATUHA));
                // const BARMATUHA_BALANCE = await BARMATUHA_CONTRACT.methods.balanceOf(item.address).call();
                // const human_BARMATUHA = parseFloat(ethers.utils.formatEther(BARMATUHA_BALANCE));
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

    // const okx = JSON.parse(readFileSync("okx.json", "utf-8"));
    // for (let o of okx.data) {
    //     console.log(o.address);
    // }
    // process.exit(1);

    const save_wallet_state = queue((_, cb) => {
        writeFileSync(WALLET_PATH, JSON.stringify(WALLETS));
        cb(null);
    }, 1);

    switch (task) {
        case "import":
            {
                const new_keys = readFileSync("keys", "utf-8").split("\n");
                let imported = 0;
                for (let private_key of new_keys) {
                    private_key = private_key.toLowerCase().replace(/(\r\n|\n|\r)/gm, "");
                    if (JSON.stringify(WALLETS).indexOf(private_key) === -1) {
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
                    console.log(`::INFO WAITING FOR THE L1 BLOCK: ${CLAIM_START}`);
                    while (true) {
                        try {
                            const block = await MULTICALL_CONTRACT.methods.getL1BlockNumber().call();
                            if (block >= CLAIM_START) {
                                break;
                            }
                        } catch {
                            console.log(`ERROR WHILE CHECKING BLOCK NUMBER`);
                            // continue regardless of error
                        }
                    }
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
                    let total = 0;
                    for (let item of WALLETS) {
                        if (item.claimable) {
                            total += item.claimable;
                        }
                    }
                    console.log(`::INFO CLAIM INFO UPDATED! TOTAL TO CLAIM: ${total}`);
                } catch (e) {
                    console.log(`::ERROR CLAIM INFO: ${e.message}`);
                }
            }
            break;
        case "set-cex":
            {
                console.log(`::INFO START SET DEX ADDRESSES`);
                const unique_cex = [];
                let duplicates = 0;
                const dex_deposit_addresses = readFileSync("cex", "utf-8").split("\n");
                for (let transfer_to of dex_deposit_addresses) {
                    transfer_to = transfer_to.toLowerCase().replace(/(\r\n|\n|\r)/gm, "");
                    if (unique_cex.indexOf(transfer_to) === -1) {
                        unique_cex.push(transfer_to);
                    } else {
                        duplicates += 1;
                        console.log(`::ERROR FOUND DUPLICATED: ${transfer_to}`);
                    }
                }
                console.log(`::INFO START SET DEX ADDRESSES: TOTAL UNIQUE CEX ADDRESSES: ${unique_cex.length} : DUPLICATES: ${duplicates}`);
                let set = 0;
                for (let item of WALLETS) {
                    if (!item.transfer_to && item.claimable > 0) {
                        for (let transfer_to of dex_deposit_addresses) {
                            transfer_to = transfer_to.toLowerCase().replace(/(\r\n|\n|\r)/gm, "");
                            if (JSON.stringify(WALLETS).indexOf(transfer_to) === -1) {
                                item.transfer_to = transfer_to;
                                console.log("SET: ", item.address, transfer_to);
                                set += 1;
                                break;
                            }
                        }
                    } else {
                        // if (item.transfer_to) {
                        //     console.log(item.address, "->", item.transfer_to, item.claimable);
                        // }
                    }
                }
                writeFileSync(WALLET_PATH, JSON.stringify(WALLETS));
                console.log(`::INFO TOTAL SET DEX ADDRESSES: ${set}`);
            }
            break;
        case "reset-cex":
            {
                console.log(`::INFO START RESET DEX ADDRESSES`);
                let set = 0;
                for (let item of WALLETS) {
                    if (item.transfer_to) {
                        item.transfer_to = "";
                        set += 1;
                    }
                }
                writeFileSync(WALLET_PATH, JSON.stringify(WALLETS));
                console.log(`::INFO TOTAL RESETSET DEX ADDRESSES: ${set}`);
            }
            break;
        case "check-cex":
            {
                console.log(`::INFO START CHECKING DEX ADDRESSES`);
                let duplicates = 0;
                let total_sendble = 0;
                const uniqueu_cex = [];
                for (let item of WALLETS) {
                    if (item.transfer_to) {
                        if (uniqueu_cex.indexOf(item.transfer_to) === -1) {
                            uniqueu_cex.push(item.transfer_to);
                            console.log(item.address, "->", item.transfer_to, item.claimable);
                            total_sendble += item.claimable;
                        } else {
                            console.log(`::INFO DUPLICATE FOUND ${item.address} -> ${item.transfer_to}`);
                            duplicates += 1;
                        }
                    }
                }
                console.log(`::INFO TOTAL UNIQUE CEX: ${uniqueu_cex.length} TOTAL DUPLICATES: ${duplicates} TOTAL TO SEND: ${total_sendble}`);
            }
            break;
        default:
            console.log(`::ERROR NO SUCH COMMAND`);
            break;
    }
})();
