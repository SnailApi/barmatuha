import { readFileSync, writeFileSync } from "fs";
import { queue, forEachLimit } from "async";
import ethers from "ethers";
import Web3 from "web3";
import * as dotenv from "dotenv";
import HttpsProxyAgent from "https-proxy-agent";
import fetch from "node-fetch";
dotenv.config();

import { CLAIM_ABI, ARB_ABI, MULTICALL_ABI, ARB_DOGE_CLAIM_ABI, ODOS_ABI, TALLY_VOTE_ABI, TALLY_SECURITY_COUNCIL_ABI } from "./abi.mjs";
import { depositThroughOkx } from "./funding.mjs";

const web3 = new Web3(process.env.RPC);
const CLAIM_ADDRESS = "0x67a24CE4321aB3aF51c2D0a4801c3E111D88C9d9";
const CLAIM_CONTRACT = new web3.eth.Contract(CLAIM_ABI, CLAIM_ADDRESS);

const BARMATUHA_ADDRESS = "0x912ce59144191c1204e64559fe8253a0e49e6548";
const BARMATUHA_CONTRACT = new web3.eth.Contract(ARB_ABI, BARMATUHA_ADDRESS);

const MULTICALL_ADDRESS = "0x842eC2c7D803033Edf55E478F461FC547Bc54EB2";
const MULTICALL_CONTRACT = new web3.eth.Contract(MULTICALL_ABI, MULTICALL_ADDRESS);

const TALLY_ADDRESS = "0x789fc99093b09ad01c34dc7251d0c89ce743e5a4";
const TALLY_CONTRACT = new web3.eth.Contract(TALLY_VOTE_ABI, TALLY_ADDRESS);

const TALLY_SEC_COUNCIL_ADDRESS = "0x467923b9ae90bdb36ba88eca11604d45f13b712c";
const TALLY_SEC_COUNCIL_CONTRACT = new web3.eth.Contract(TALLY_SECURITY_COUNCIL_ABI, TALLY_SEC_COUNCIL_ADDRESS);
/**
 * Shit parts
 */
const SHIT_CLAIM_ADDRESS = "0x0857832548ab9dd3724943305b1ca5d230341b90";
const SHIT_CLAIM_CONTRACT = new web3.eth.Contract(ARB_DOGE_CLAIM_ABI, SHIT_CLAIM_ADDRESS);
const SHIT_ADDRESS = "0xB5B5b428e4DE365F809CeD8271D202449e5c2F72";
const SHIT_CONTRACT = new web3.eth.Contract(ARB_ABI, SHIT_ADDRESS);

const CLAIM_START = 16890400;

const shuffleArray = (array) => {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
};

const transfer_to = async (item, to_transfer, transfer_to) => {
    const query = BARMATUHA_CONTRACT.methods.transfer(transfer_to, to_transfer);

    const tx = {
        type: 2,
        from: item.address,
        to: BARMATUHA_ADDRESS,
        data: query.encodeABI(),
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
            1,
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
                if (item.sendable > 0 && item.transfer_to) {
                    const BARMATUHA = await CLAIM_CONTRACT.methods.claimableTokens(item.address).call();
                    const BARMATUHA_BALANCE = await BARMATUHA_CONTRACT.methods.balanceOf(item.address).call();

                    if (BARMATUHA_BALANCE && item.transfer_to && !item.transfered) {
                        try {
                            await transfer_to(item, BARMATUHA_BALANCE, item.transfer_to);
                            info.transfered += 1;
                            item.transfered = true;
                            console.log(
                                `::INFO TRANSFER COMPLETED: ${item.address} -> ${item.transfer_to} ${parseFloat(
                                    ethers.utils.formatEther(BARMATUHA_BALANCE),
                                )}`,
                            );
                            item.transfer_to = "";
                            wallet_state.push("");
                        } catch (e) {
                            console.log(`::ERROR TRANSFER: ${item.address} ${e.message}`);
                            info.transfer_error += 1;
                        }
                        await new Promise((r) => setTimeout(r, 5000));
                    } else {
                        if (BARMATUHA > 0) {
                            console.log(
                                `::WARNING CLAIM NOT COMPLETED TRY AGAIN! LEFT TO CLAIM: ${item.address} -> ${parseFloat(
                                    ethers.utils.formatEther(BARMATUHA),
                                )}`,
                            );
                        }
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
            2,
            async (item) => {
                const BARMATUHA = await CLAIM_CONTRACT.methods.claimableTokens(item.address).call();
                const human_BARMATUHA = parseFloat(ethers.utils.formatEther(BARMATUHA));
                if (human_BARMATUHA > 0) {
                    item.claimed = false;
                } else {
                    item.claimed = true;
                }
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

const balance_info = async (wallet_state, wallets) => {
    return new Promise((resolve) => {
        forEachLimit(
            wallets,
            2,
            async (item) => {
                const BARMATUHA_BALANCE = await BARMATUHA_CONTRACT.methods.balanceOf(item.address).call();
                const human_BARMATUHA = parseFloat(ethers.utils.formatEther(BARMATUHA_BALANCE));
                //item.sendable = BARMATUHA_BALANCE / 1000000;
                item.sendable = human_BARMATUHA;
                wallet_state.push("");
                console.log(item.address, item.sendable);
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

const balance_eth = async (wallet_state, wallets) => {
    let total = 0;
    return new Promise((resolve) => {
        forEachLimit(
            wallets,
            1,
            async (item) => {
                const balance = await web3.eth.getBalance(item.address);
                const human_balance = parseFloat(ethers.utils.formatEther(balance));
                total += human_balance;
                console.log(item.address, human_balance);
            },
            (e) => {
                if (e) {
                    console.log(e);
                }
                resolve(total);
            },
        );
    });
};

const delegate = async (item) => {
    const query = BARMATUHA_CONTRACT.methods.delegate(item.address);

    const tx = {
        type: 2,
        to: BARMATUHA_ADDRESS,
        data: query.encodeABI(),
    };
    tx.gas = await web3.eth.estimateGas(tx);
    const signed = await web3.eth.accounts.signTransaction(tx, item.private_key);
    await web3.eth.sendSignedTransaction(signed.rawTransaction);
};

const mass_delegate = async (wallet_state, wallets) => {
    return new Promise((resolve) => {
        forEachLimit(
            wallets,
            1,
            async (item) => {
                if (!item.delegate && item.sendable > 0) {
                    try {
                        await delegate(item);
                        item.delegate = true;
                        wallet_state.push("");
                        console.log(`::INFO ${item.address} DELEGATION COMPLETED`);
                    } catch (e) {
                        coconsole.log(`::ERROR ${item.address} ${e.message}`);
                    }
                }
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

const claim_shit = async (item, payload) => {
    const query = SHIT_CLAIM_CONTRACT.methods.claim(payload.nonce, payload.signature, "0x0000000000000000000000000000000000000000");

    const tx = {
        type: 2,
        from: item.address,
        to: SHIT_CLAIM_ADDRESS,
        data: query.encodeABI(),
        // maxFeePerGas: web3.utils.toWei("0.1", "gwei"),
        // maxPriorityFeePerGas: ethers.utils.parseUnits(`0.01`, "gwei"),
    };
    tx.gas = await web3.eth.estimateGas(tx);
    //process.exit(1);
    const signed = await web3.eth.accounts.signTransaction(tx, item.private_key);
    await web3.eth.sendSignedTransaction(signed.rawTransaction);
};

const claim_shit_get_signature = async (item) => {
    const options = {
        method: "POST",
        headers: {
            authority: "bruhcoin.co",
            accept: "application/json, text/plain, */*",
            "accept-language": "en-US,en;q=0.9,ru;q=0.8",
            "cache-control": "no-cache",
            "content-length": "0",
            origin: "https://bruhcoin.co",
            pragma: "no-cache",
            referer: "https://bruhcoin.co/",
            "sec-ch-ua": '"Google Chrome";v="113", "Chromium";v="113", "Not-A.Brand";v="24"',
            "sec-ch-ua-mobile": "?0",
            "sec-ch-ua-platform": '"macOS"',
            "sec-fetch-dest": "empty",
            "sec-fetch-mode": "cors",
            "sec-fetch-site": "same-origin",
            "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/113.0.0.0 Safari/537.36",
        },
        // body: JSON.stringify({
        //     address: item.address,
        // }),
        agent: new HttpsProxyAgent("http://cardinal:cardinal@gate.dc.smartproxy.com:20000"),
    };
    const response = await fetch(`https://bruhcoin.co/api/sinature?userAddress=${item.address}`, options);
    if (response.status === 200) {
        const data = await response.json();
        if (data.error) {
            throw new Error(JSON.stringify(data));
        }
        return data;
    }
    throw new Error(await response.json());
};

const claim_shit_task = async (wallet_state, wallets, shit_name) => {
    return new Promise((resolve) => {
        forEachLimit(
            wallets,
            3,
            async (item) => {
                const claim_param = `claim_${shit_name}`;
                if (!item[claim_param]) {
                    try {
                        //const { content } = await get_lgnd_message(item);
                        //
                        const payload = await claim_shit_get_signature(item);
                        //const payload = data;
                        // const wallet = new ethers.Wallet(item.private_key);
                        // const signed_message = await wallet.signMessage(content);
                        // const signature = await auth_that_shit(item, payload);
                        await claim_shit(item, payload);
                        item[claim_param] = true;
                        wallet_state.push("");
                        console.log(`::INFO ${item.address} CLAIM ${shit_name} COMPLETED`);
                    } catch (e) {
                        if (e.message.indexOf(": already claimed") > -1) {
                            item[claim_param] = true;
                            wallet_state.push("");
                        }
                        console.log(`::ERROR ${item.address} ${e.message}`);
                    }
                }
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

const approve_token = async (item) => {
    const tx = {
        type: 2,
        from: item.address,
        to: "0xb5b5b428e4de365f809ced8271d202449e5c2f72",
        //data: `0x095ea7b3000000000000000000000000dd94018f54e565dbfc939f7c44a16e163faab33100000000000000000000000000000000000000000000000001ecdbe000000000`, //odos
        data: `0x095ea7b3000000000000000000000000c873fecbd354f5a56e00e710b90ef4201db2448d000000000000000000000000000000000000000000000000000047d7c219a000`, //camelot
        // maxFeePerGas: web3.utils.toWei("0.12", "gwei"),
        // maxPriorityFeePerGas: ethers.utils.parseUnits(`0.01`, "gwei"),
    };
    tx.gas = await web3.eth.estimateGas(tx);
    const signed = await web3.eth.accounts.signTransaction(tx, item.private_key);
    await web3.eth.sendSignedTransaction(signed.rawTransaction);
};

const odos_swaper = async (item, payload) => {
    const tx = {
        //type: 2,
        from: item.address,
        to: "0xc873fecbd354f5a56e00e710b90ef4201db2448d",
        // maxFeePerGas: web3.utils.toWei("0.135", "gwei"),
        // maxPriorityFeePerGas: ethers.utils.parseUnits(`0.0`, "gwei"),
        gas: await web3.eth.getGasPrice(),
        data: `0x52aa4c22000000000000000000000000000000000000000000000000000047d7c219a0000000000000000000000000000000000000000000000000000012519eeee2c5f000000000000000000000000000000000000000000000000000000000000000c0000000000000000000000000${
            item.address.split("0x")[1]
        }000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000645d48990000000000000000000000000000000000000000000000000000000000000002000000000000000000000000b5b5b428e4de365f809ced8271d202449e5c2f7200000000000000000000000082af49447d8a07e3bd95bd0d56f35241523fbab1`,
    };
    tx.gas = await web3.eth.estimateGas(tx);
    const signed = await web3.eth.accounts.signTransaction(tx, item.private_key);
    await web3.eth.sendSignedTransaction(signed.rawTransaction);
};

const swap_arbdoge_task = async (wallet_state, wallets) => {
    return new Promise((resolve) => {
        forEachLimit(
            wallets,
            1,
            async (item) => {
                if (item.claim_bruh && !item.bruh_completed) {
                    try {
                        const balance = await SHIT_CONTRACT.methods.balanceOf(item.address).call();
                        if (balance === "0") {
                            item.bruh_completed = true;
                            wallet_state.push("");
                            return;
                        }
                        if (parseInt(balance) >= 73193600000000) {
                            if (!item.approved_bruh_camelot) {
                                await approve_token(item);
                                console.log(`::INFO ${item.address} SWAP CAMELOT APPROVE COMPLETED`);
                                item.approved_bruh_camelot = true;
                                wallet_state.push("");
                            }
                            console.log(`::INFO ${item.address} SWAP CAMELOT STARTED`);
                            await odos_swaper(item);
                            item.bruh_completed = true;
                            wallet_state.push("");
                            console.log(`::INFO ${item.address} SWAP CAMELOT COMPLETED`);
                        }
                    } catch (e) {
                        if (e.message.indexOf(`"status": false`) > -1) {
                            e.message = "tx failed";
                        }
                        console.log(`::ERROR ${item.address} ${e.message}`);
                        //await new Promise((r) => setTimeout(r, 50000));
                    }
                }
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

const snapshot_get_message = (item, choice, proposal, space) => ({
    domain: {
        name: "snapshot",
        version: "0.1.4",
    },
    types: {
        Vote: [
            {
                name: "from",
                type: "address",
            },
            {
                name: "space",
                type: "string",
            },
            {
                name: "timestamp",
                type: "uint64",
            },
            {
                name: "proposal",
                type: "bytes32",
            },
            {
                name: "choice",
                type: "uint32",
            },
            {
                name: "reason",
                type: "string",
            },
            {
                name: "app",
                type: "string",
            },
            {
                name: "metadata",
                type: "string",
            },
        ],
    },
    message: {
        space,
        proposal,
        choice,
        app: "snapshot",
        reason: "",
        metadata: "{}",
        from: item.address,
        timestamp: Math.floor(Date.now() / 1000),
    },
});

const snapshot_voter = async (item, data, sig) => {
    const options = {
        method: "POST",
        headers: {
            authority: "seq.snapshot.org",
            accept: "application/json",
            "accept-language": "en-US,en;q=0.9,ru;q=0.8",
            "cache-control": "no-cache",
            "content-type": "application/json",
            origin: "https://snapshot.org",
            pragma: "no-cache",
            referer: "https://snapshot.org/",
            "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/111.0.0.0 Safari/537.36",
        },
        body: JSON.stringify({
            address: item.address,
            sig,
            data,
        }),
        agent: new HttpsProxyAgent("http://cardinal:cardinal@gate.dc.smartproxy.com:20000"),
    };
    const response = await fetch("https://seq.snapshot.org/", options);
    if (response.status === 200) {
        return;
    }
    throw new Error(await response.text());
};

const snapshot_mass_voter = async (wallet_state, wallets, snapshot_proposal) => {
    return new Promise((resolve) => {
        forEachLimit(
            wallets,
            3,
            async (item) => {
                if (item.sendable > 0) {
                    if (!item.snapshot_vote) {
                        item.snapshot_vote = [];
                    }
                    if (item.snapshot_vote.indexOf(snapshot_proposal) === -1) {
                        const wallet = new ethers.Wallet(item.private_key);
                        item.address = wallet.address;
                        // const choices = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
                        // shuffleArray(choices);
                        const choices = 1;
                        const message = snapshot_get_message(item, choices, snapshot_proposal, "arbitrumfoundation.eth");
                        const signature = await wallet._signTypedData(message.domain, message.types, message.message);
                        try {
                            await snapshot_voter(item, message, signature);
                            item.snapshot_vote.push(snapshot_proposal);
                            wallet_state.push("");
                            console.log(`::INFO ${item.address} SNAPSHOT VOTE COMPLETED`);
                        } catch (e) {
                            console.log(`::ERROR ${item.address} SNAPSHOT VOTE ERROR: ${e.message}`);
                        }
                    }
                }
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

const tally_vote_call = async (item, proposal) => {
    const query = TALLY_CONTRACT.methods.castVote(proposal, "1");

    const tx = {
        type: 2,
        from: item.address,
        to: TALLY_ADDRESS,
        data: query.encodeABI(),
        maxFeePerGas: web3.utils.toWei("0.135", "gwei"),
        maxPriorityFeePerGas: web3.utils.toWei("0.0", "gwei"),
    };
    tx.gas = await web3.eth.estimateGas(tx);
    const signed = await web3.eth.accounts.signTransaction(tx, item.private_key);
    await web3.eth.sendSignedTransaction(signed.rawTransaction);
};

const tally_voter = async (wallet_state, wallets, proposal) => {
    return new Promise((resolve) => {
        forEachLimit(
            wallets,
            1,
            async (item) => {
                if (item.sendable > 0) {
                    if (!item.tally_vote) {
                        item.tally_vote = [];
                    }
                    if (item.tally_vote.indexOf(proposal) === -1) {
                        try {
                            await tally_vote_call(item, proposal);
                            item.tally_vote.push(proposal);
                            wallet_state.push("");
                            console.log(`::INFO ${item.address} :: TALLY VOTE :: COMPLETED`);
                        } catch (e) {
                            if (e.message.indexOf("vote already cast") > -1) {
                                item.tally_vote.push(proposal);
                                wallet_state.push("");
                                console.log(`::INFO ${item.address} :: TALLY VOTE :: COMPLETED`);
                                return;
                            }
                            item.fund_me = true;
                            wallet_state.push("");
                            console.log(`::ERROR ${item.address} :: TALLY VOTE :: ERROR: ${e.message}`);
                        }
                        await new Promise((r) => setTimeout(r, Math.floor(Math.random() * (30000 - 5000 + 1) + 5000)));
                    }
                }
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

const tally_security_council_vote_call = async (item, proposal, voting_power) => {
    const members = [
        "0xb71ca4FFbB7b58d75Ba29891ab45e9Dc12B444Ed",
        "0xfD7631b7a5716FCA8D95207Da2A7BcD471ee0372",
        "0x914B7c77037951EBAC9e4046093e9D1C6daE1332",
        "0x748a1D2EDd08245d0A139d3DFFfEe92312A25C26",
        "0x9f2b47f969c7669D532dC8FE0F1B1907a99429fC",
        "0xf8e1492255d9428c2Fc20A98A1DeB1215C8ffEfd",
    ];
    const member = members[Math.floor(Math.random() * members.length)].toLowerCase().split("0x")[1];
    const query = TALLY_CONTRACT.methods.castVoteWithReasonAndParams(
        proposal,
        "1",
        "",
        `0x000000000000000000000000${member}0000000000000000000000000000000000000000000000${voting_power}`,
    );

    const tx = {
        type: 2,
        from: item.address,
        to: TALLY_SEC_COUNCIL_ADDRESS,
        data: query.encodeABI(),
        maxFeePerGas: web3.utils.toWei("0.135", "gwei"),
        maxPriorityFeePerGas: web3.utils.toWei("0.0", "gwei"),
    };
    tx.gas = await web3.eth.estimateGas(tx);
    const signed = await web3.eth.accounts.signTransaction(tx, item.private_key);
    await web3.eth.sendSignedTransaction(signed.rawTransaction);
};

const security_council_voting = async (wallet_state, wallets, proposal) => {
    return new Promise((resolve) => {
        forEachLimit(
            wallets,
            1,
            async (item) => {
                if (item.sendable > 0) {
                    if (!item.security_council) {
                        item.security_council = [];
                    }
                    if (item.security_council.indexOf(proposal) === -1) {
                        try {
                            const voting_power = ethers.utils.parseEther(`${item.sendable}`).toHexString().split("0x")[1];
                            await tally_security_council_vote_call(item, proposal, voting_power);
                            item.security_council.push(proposal);
                            wallet_state.push("");
                            console.log(`::INFO ${item.address} :: TALLY SECURITY COUNCIL VOTE :: COMPLETED`);
                        } catch (e) {
                            if (e.message.indexOf("vote already cast") > -1) {
                                item.security_council.push(proposal);
                                wallet_state.push("");
                                console.log(`::INFO ${item.address} :: TALLY SECURITY COUNCIL VOTE :: COMPLETED`);
                                return;
                            }
                            wallet_state.push("");
                            console.log(`::ERROR ${item.address} :: TALLY SECURITY COUNCIL VOTE :: ERROR: ${e.message}`);
                        }
                        await new Promise((r) => setTimeout(r, Math.floor(Math.random() * (30000 - 5000 + 1) + 5000)));
                    }
                }
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
    const async_events = process.argv[3] || 1;
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
        case "snapshot":
            {
                const snapshot_proposal = process.argv[3];
                if (!snapshot_proposal) {
                    console.log(`::ERROR SNAPSHOT PROPOSAL ID REQUIRED`);
                    return;
                }
                try {
                    console.log(`::INFO SNAPSHOT VOTER STARTED: ${snapshot_proposal}`);
                    await snapshot_mass_voter(save_wallet_state, WALLETS, snapshot_proposal);
                    console.log(`::INFO SNAPSHOT VOTER COMPLETED: ${snapshot_proposal}`);
                } catch (e) {
                    console.log(`::ERROR SNAPSHOT VOTER: ${e.message}`);
                }
            }
            break;
        case "claim-info":
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
        case "balance-info":
            {
                try {
                    let total_accounts = 0;
                    console.log(`::INFO BALANCE INFO STARTED`);
                    await balance_info(save_wallet_state, WALLETS);
                    let total = 0;
                    for (let item of WALLETS) {
                        if (item.sendable) {
                            total_accounts += 1;
                            total += item.sendable;
                        }
                    }
                    console.log(`::INFO BALANCE INFO UPDATED! TOTAL TO SEND: ${total} : ${total_accounts}`);
                } catch (e) {
                    console.log(`::ERROR CLAIM INFO: ${e.message}`);
                }
            }
            break;
        case "tally-vote":
            {
                const proposal = process.argv[3];
                if (!proposal) {
                    console.log(`::ERROR :: MISSING PROPOSAL ID`);
                    return;
                }
                try {
                    console.log(`::INFO :: PROPOSAL VOTING STARTED :: ${proposal}`);
                    await tally_voter(save_wallet_state, WALLETS, proposal);
                    console.log(`::INFO BALANCE INFO UPDATED! TOTAL TO SEND: ${total} : ${total_accounts}`);
                } catch (e) {
                    console.log(`::ERROR CLAIM INFO: ${e.message}`);
                }
            }
            break;
        case "security-c":
            {
                const proposal = process.argv[3] || "60162688034199076810399696553527335539392294406806148400571326246927623831080";
                if (!proposal) {
                    console.log(`::ERROR :: MISSING PROPOSAL ID`);
                    return;
                }
                try {
                    console.log(`::INFO :: SECURITY COUNCIL VOTING STARTED :: ${proposal}`);
                    await security_council_voting(save_wallet_state, WALLETS, proposal);
                    console.log(`::INFO :: SECURITY COUNCIL VOTING COMPLETED`);
                } catch (e) {
                    console.log(`::ERROR CLAIM INFO: ${e.message}`);
                }
            }
            break;
        case "balance-eth":
            {
                try {
                    console.log(`::INFO BALANCE ETH STARTED`);
                    const total_balance = await balance_eth(save_wallet_state, WALLETS);
                    console.log(`::INFO BALANCE ETH UPDATED! TOTAL TO SEND: ${total_balance}`);
                } catch (e) {
                    console.log(`::ERROR BALANCE ETH: ${e.message}`);
                }
            }
            break;
        case "delegate":
            {
                try {
                    console.log(`::INFO DELEGATE START`);
                    await mass_delegate(save_wallet_state, WALLETS);
                    console.log(`::INFO DELEGATE COMPLETED`);
                } catch (e) {
                    console.log(`::ERROR DELEGATE: ${e.message}`);
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
                let total_to_send = 0;
                for (let item of WALLETS) {
                    if (!item.transfer_to && item.sendable > 0) {
                        for (let transfer_to of dex_deposit_addresses) {
                            transfer_to = transfer_to.toLowerCase().replace(/(\r\n|\n|\r)/gm, "");
                            if (JSON.stringify(WALLETS).indexOf(transfer_to) === -1) {
                                item.transfer_to = transfer_to;
                                console.log("SET: ", item.address, transfer_to, item.sendable);
                                total_to_send += item.sendable;
                                set += 1;
                                break;
                            }
                        }
                    }
                }
                writeFileSync(WALLET_PATH, JSON.stringify(WALLETS));
                console.log(`::INFO TOTAL SET DEX ADDRESSES: ${set} : TOTAL TO SEND :${total_to_send}`);
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
        case "claim-shit":
            try {
                console.log(`::INFO CLAIM SHIT`);
                await claim_shit_task(save_wallet_state, WALLETS, "bruh");
                console.log(`::INFO CLAIM SHIT`);
            } catch (e) {
                console.log(`::ERROR CLAIM SHIT: ${e.message}`);
            }
            break;
        case "okx-funding":
            try {
                console.log(`::INFO DEPOSIT THROUGH OKX :: STARTED`);
                await depositThroughOkx(WALLETS, save_wallet_state);
                console.log(`::INFO DEPOSIT THROUGH OKX :: COMPLETED`);
            } catch (e) {
                console.log(`::ERROR DEPOSIT THROUGH OKX :: ${e.message}`);
            }
            break;
        case "swap-shit":
            try {
                console.log(`::INFO SWAP SHIT`);
                await swap_arbdoge_task(save_wallet_state, WALLETS);
                console.log(`::INFO SWAP SHIT`);
            } catch (e) {
                console.log(`::ERROR SWAP SHIT: ${e.message}`);
            }
            break;
        default:
            console.log(`::ERROR NO SUCH COMMAND`);
            break;
    }
})();
