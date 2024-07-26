import * as web3 from "@solana/web3.js";

import {
  createAccount,
  createMint,
  mintTo,
  TOKEN_PROGRAM_ID,
  getMint,
  getAccount,
  approve,
  Mint,
  getOrCreateAssociatedTokenAccount,
  Account,
} from "@solana/spl-token";

import {
  TokenSwap,
  CurveType,
  TOKEN_SWAP_PROGRAM_ID,
} from "@solana/spl-token-swap";

import Dotenv from "dotenv";
Dotenv.config();

// The following globals are created by `createTokenSwap` and used by subsequent tests
// Token swap
let tokenSwap: TokenSwap;
// swapAuthority of the token and accounts
let swapAuthority: web3.PublicKey;
// bump seed used to generate the swapAuthority public key
let bumpSeed: number;
// owner of the user accounts
let owner: web3.Keypair;
// Token pool
let tokenPool: web3.PublicKey;
let tokenAccountPool: Account;
let feeAccount: web3.PublicKey;
// Tokens swapped
let mintA: web3.PublicKey;
let mintB: web3.PublicKey;
let tokenAccountA: web3.PublicKey;
let tokenAccountB: web3.PublicKey;

// NOTE: Not sure what this is for
// Hard-coded fee address
const SWAP_PROGRAM_OWNER_FEE_ADDRESS =
  process.env.SWAP_PROGRAM_OWNER_FEE_ADDRESS;

// Pool fees
const TRADING_FEE_NUMERATOR = 25;
const TRADING_FEE_DENOMINATOR = 10000;
const OWNER_TRADING_FEE_NUMERATOR = 5;
const OWNER_TRADING_FEE_DENOMINATOR = 10000;
const OWNER_WITHDRAW_FEE_NUMERATOR = SWAP_PROGRAM_OWNER_FEE_ADDRESS ? 0 : 1;
const OWNER_WITHDRAW_FEE_DENOMINATOR = SWAP_PROGRAM_OWNER_FEE_ADDRESS ? 0 : 6;
const HOST_FEE_NUMERATOR = 20;
const HOST_FEE_DENOMINATOR = 100;

// Initial amount in each swap token
let currentSwapTokenA = 1000000;
let currentSwapTokenB = 1000000;
let currentFeeAmount = 0;

// NOTE: Not sure reason for calculations / different numbers, or what is HOST
// Swap instruction constants
// Because there is no withdraw fee in the production version, these numbers
// need to get slightly tweaked in the two cases.
const SWAP_AMOUNT_IN = 100000;
const SWAP_AMOUNT_OUT = SWAP_PROGRAM_OWNER_FEE_ADDRESS ? 90661 : 90674;
const SWAP_FEE = SWAP_PROGRAM_OWNER_FEE_ADDRESS ? 22273 : 22277;
const HOST_SWAP_FEE = SWAP_PROGRAM_OWNER_FEE_ADDRESS
  ? Math.floor((SWAP_FEE * HOST_FEE_NUMERATOR) / HOST_FEE_DENOMINATOR)
  : 0;
const OWNER_SWAP_FEE = SWAP_FEE - HOST_SWAP_FEE;

// Pool token amount minted on init
const DEFAULT_POOL_TOKEN_AMOUNT = 1000000000;
// Pool token amount to withdraw / deposit
const POOL_TOKEN_AMOUNT = 10000000;

// Connection
const connection = new web3.Connection(web3.clusterApiUrl("devnet"));
// const connection = new web3.Connection("http://127.0.0.1:8899", "confirmed");

async function main() {
    // owner is from .env file
    owner = initializeKeypair();
    console.log("Owner's publickey => ", owner.publicKey.toBase58());
    await connection.requestAirdrop(owner.publicKey, web3.LAMPORTS_PER_SOL * 2);
  
    // swapPayer randomly generated and require some SOL to make transactions
    const swapPayer = web3.Keypair.generate();
    console.log("swapPayer => ", swapPayer.publicKey.toBase58());
    await connection.requestAirdrop(swapPayer.publicKey,web3.LAMPORTS_PER_SOL * 2);
  
    // tokenSwapAccount is randomly generated keypair to use when initializing TokenSwap
    const tokenSwapAccount = web3.Keypair.generate();
  
    // swapAuthority is a PDA found using tokenSwapAccount and TOKEN_SWAP_PROGRAM_ID as seeds
    [swapAuthority, bumpSeed] = web3.PublicKey.findProgramAddressSync(
      [tokenSwapAccount.publicKey.toBuffer()],
      TOKEN_SWAP_PROGRAM_ID
    );
    console.log("tokenSwapAccount =>", tokenSwapAccount.publicKey.toBase58());
  
    console.log(" ---------- creating pool mint(LP Tokens) ---------- ");
    // tokenPool is a TOKEN MINT for pool token(LP Tokens)
    tokenPool = await createMint(connection, owner, swapAuthority, null, 2);
    console.log("tokenPool => ", tokenPool.toBase58());
  
    console.log(" ---------- creating pool mint(LP) ATA account ----------");
    // tokenAccountPool is a TOKEN ACCOUNT associated with tokenPool MINT
    // this TOKEN ACCOUNT will be minted pool tokens when TokenSwap is initialized
    tokenAccountPool = await getOrCreateAssociatedTokenAccount(
      connection,
      owner,
      tokenPool,
      owner.publicKey
    );
    console.log("tokenAccountPool => ", tokenAccountPool.address.toBase58());
  
    // feeAccount is a TOKEN ACCOUNT associated with tokenPool MINT
    // fees collected will be minted to this TOKEN ACCOUNT
    feeAccount = await createAccount(
      connection,
      owner,
      tokenPool,
      owner.publicKey  //     owner will collect the fees colleted(LP tokens)
    );
    console.log("feeAccountPool => ", feeAccount.toBase58());
  
    console.log(" ---------- creating token A ---------- ");
    // mintA is a TOKEN MINT for token A
    mintA = await createMint(connection, owner, owner.publicKey, null, 2);
    console.log("mintA token address =>", mintA.toBase58());
  
    // tokenAccountA is a TOKEN ACCOUNT associated with mintA MINT
    // tokenAccountA is owned by swapAuthority (PDA)
    tokenAccountA = await createAccount(
      connection,
      owner,
      mintA,
      swapAuthority,
      new web3.Keypair()
    );
    console.log("tokenA ATA(owner: swapAuthority) => ", tokenAccountA.toBase58());
  
    // mint Token A tokens to tokenAccountA TOKEN ACCOUNT
    await mintTo(connection, owner, mintA, tokenAccountA, owner, currentSwapTokenA);
  
    console.log(" ---------- creating token B ---------- ");
    // mintB is a TOKEN MINT for token B
    mintB = await createMint(connection, owner, owner.publicKey, null, 2);
    console.log("mintB token address => ", mintB.toBase58());
  
    // tokenAccountB is a TOKEN ACCOUNT associated with mintB MINT
    // tokenAccountB is owned by swapAuthority (PDA)
    tokenAccountB = await createAccount(
      connection,
      owner,
      mintB,
      swapAuthority,
      new web3.Keypair()
    );
    console.log("tokenB ATA(owner: swapAuthority) => ", tokenAccountB.toBase58());
  
    // mint Token B tokens to tokenAccountB TOKEN ACCOUNT
    await mintTo(connection, owner, mintB, tokenAccountB, owner, currentSwapTokenB);
  
    console.log(" ---------- creating token swap pool on devnet ---------- ");
    // call createTokenSwap instruction on TokenSwap Program
    tokenSwap = await TokenSwap.createTokenSwap(
      connection,
      swapPayer, // Pays for the transaction, requires type "Account" even though depreciated
      tokenSwapAccount, // The token swap account, requires type "Account" even though depreciated
      swapAuthority, // The swapAuthority over the swap and accounts
      tokenAccountA, // The token swap's Token A account, owner is swapAuthority (PDA)
      tokenAccountB, // The token swap's Token B account, owner is swapAuthority (PDA)
      tokenPool, // The pool token MINT
      mintA, // The mint of Token A
      mintB, // The mint of Token B
      feeAccount, // pool token TOKEN ACCOUNT where fees are sent
      tokenAccountPool.address, // pool token TOKEN ACCOUNT where initial pool tokens are minted to when creating Token Swap
      TOKEN_SWAP_PROGRAM_ID,
      TOKEN_PROGRAM_ID,
      BigInt(TRADING_FEE_NUMERATOR),
      BigInt(TRADING_FEE_DENOMINATOR),
      BigInt(OWNER_TRADING_FEE_NUMERATOR),
      BigInt(OWNER_TRADING_FEE_DENOMINATOR),
      BigInt(OWNER_WITHDRAW_FEE_NUMERATOR),
      BigInt(OWNER_WITHDRAW_FEE_DENOMINATOR),
      BigInt(HOST_FEE_NUMERATOR), // NOTE: not sure what HOST refers to
      BigInt(HOST_FEE_DENOMINATOR),
      CurveType.ConstantPrice, // NOTE: not really sure CurveType calculations, constant price/product
    );
  
    // loadTokenSwap returns info about a TokenSwap using its address
    console.log(" ---------- loading token swap pool data ---------- ");
    const fetchedTokenSwap = await TokenSwap.loadTokenSwap(
      connection,
      tokenSwapAccount.publicKey,
      TOKEN_SWAP_PROGRAM_ID,
      swapPayer
    );
  
    console.log(fetchedTokenSwap);
}

main();

function initializeKeypair(): web3.Keypair {
    const secret = JSON.parse(process.env.PRIVATE_KEY ?? "") as number[];
    const secretKey = Uint8Array.from(secret);
    const keypairFromSecretKey = web3.Keypair.fromSecretKey(secretKey);
    return keypairFromSecretKey;
}