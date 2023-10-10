import { forEachLimit } from "async";
import fetch from "node-fetch";
import HttpsProxyAgent from "https-proxy-agent";
import { createHmac } from "crypto";

// Deposit through okx
export const depositThroughOkx = (WALLETS, queuee) => {
    const withdraw_to = ["Arbitrum One"];
    return new Promise((resolve) => {
        forEachLimit(
            WALLETS,
            1,
            async (item) => {
                if (!global.stop && item.fund_me) {
                    const to_network = withdraw_to[Math.floor(Math.random() * withdraw_to.length)];
                    const timestamp = new Date().toISOString();
                    const METHOD = "POST";
                    const PATH = "/api/v5/asset/withdrawal";
                    const TOFUND = `${parseFloat((Math.random() * (3 - 1) + 1).toFixed(4))}`;
                    const BODY = JSON.stringify({
                        ccy: "ETH",
                        amt: TOFUND,
                        dest: "4",
                        toAddr: item.address,
                        fee: "0.0001",
                        chain: `ETH-${to_network}`,
                    });
                    const to_sign = `${timestamp}${METHOD}${PATH}${BODY}`;
                    const signature = createHmac("sha256", process.env.APISECRET).update(to_sign).digest("base64");

                    const options = {
                        method: METHOD,
                        headers: {
                            "Content-Type": "application/json",
                            "OK-ACCESS-KEY": process.env.APIKEY,
                            "OK-ACCESS-SIGN": signature,
                            "OK-ACCESS-TIMESTAMP": timestamp,
                            "OK-ACCESS-PASSPHRASE": process.env.PASSPHRASE,
                        },
                        body: BODY,
                        agent: new HttpsProxyAgent(process.env.OKX_PROXY),
                    };

                    try {
                        const rp = await fetch(`https://www.okx.com${PATH}`, options);
                        const data = await rp.json();

                        if (data.code === "0") {
                            item.fund_me = false;
                            queuee.push("");
                            console.log(`::INFO ${item.address} FUND REQUEST FOR :: ${TOFUND} ETH :: ${to_network}`);
                        } else {
                            console.log(`::ERROR ${item.address} :: ${data.msg}`);
                        }
                    } catch (e) {
                        console.log(`::ERROR ${item.address} :: ${e.message}`);
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
