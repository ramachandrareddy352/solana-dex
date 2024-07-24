import { Transaction, Keypair, SystemProgram, Connection, PublicKey } from '@solana/web3.js';
import { TokenSwap, TOKEN_SWAP_PROGRAM_ID, TokenSwapLayout, CurveType } from "@solana/spl-token-swap";
import * as fs from 'fs';
import * as token from '@solana/spl-token';

function loadKeypair(filename: string) : Keypair{
    const secret = JSON.parse(fs.readFileSync(filename).toString()) as number[];
    const secretKey= Uint8Array.from (secret)
    return Keypair.fromSecretKey(secretKey)
}
async function main() {

    const connection = new Connection("https://api.devnet.solana.com");

    const wallet = loadKeypair('RCRs8L3xnMzW14pBcK8atHc85PRVyvoKmCVQE6JhLFm.json');
    console.log(`Present our wallet public key => ${wallet.publicKey.toBase58()}`)
    let transaction = new Transaction();

    // owner of lp tokens
    // tokenSwapStateAccount have to sign, so its require some sol to make transactions
    const tokenSwapStateAccount = loadKeypair('TSAFWrLukvBDm28J1DVEN7SGt2vX9aNUktY4LSzTZiC.json');
    console.log(`Token swap account => ${tokenSwapStateAccount.publicKey.toBase58()}`)

    const rent = await TokenSwap.getMinBalanceRentForExemptTokenSwap(connection); 

    // to create a swap pool first we have to create a token swpa account which saves the information data of pool in this account
    const tokenSwapStateAccountCreationInstruction = SystemProgram.createAccount({ 
        newAccountPubkey: tokenSwapStateAccount.publicKey,
        fromPubkey: wallet.publicKey,
        lamports: rent,
        space: TokenSwapLayout.span, 
        programId: TOKEN_SWAP_PROGRAM_ID
    })

    transaction.add(tokenSwapStateAccountCreationInstruction);

    //
    const [swapAuthority, bump] = PublicKey.findProgramAddressSync(
        [tokenSwapStateAccount.publicKey.toBuffer()],
        TOKEN_SWAP_PROGRAM_ID,
    )
    console.log(`Author of swap pool => ${swapAuthority.toBase58()}`);

    // create token mint account using
    // solana-keygen grind --starts-with ATK:1  => gives a account
    // spl-token create-token ATKpN4HUmKxoVRZfZQ7jJDKNifEm3LyBmi7QBnT5ptkS.json   => create the account
    const tokenAMint = new PublicKey('ATKpN4HUmKxoVRZfZQ7jJDKNifEm3LyBmi7QBnT5ptkS');
    const tokenBMint = new PublicKey('BTKqq9EqS8YXUtFZH4dSdoY6yVMuzQSy4xx48Xg7yBNz');
    console.log(`Token-A mint address => ${tokenAMint.toBase58()}`);
    console.log(`Token-B mint address => ${tokenBMint.toBase58()}`);

    //  which holds the tokens A & B when we provde the liquidity, the owner of this accounts is swap authority
    const tokenATokenAccount = await token.getAssociatedTokenAddress(
        tokenAMint,
        swapAuthority,
        true
    );
    const tokenBTokenAccount = await token.getAssociatedTokenAddress(
        tokenBMint,
        swapAuthority,
        true
    );
    console.log(`Token-A associated account => ${tokenATokenAccount.toBase58()}`);
    console.log(`Token-B associated account => ${tokenBTokenAccount.toBase58()}`);

    const tokenAAccountInstruction = token.createAssociatedTokenAccountInstruction(
        wallet.publicKey,
        tokenATokenAccount,
        swapAuthority,
        tokenAMint
    );
    const tokenBAccountInstruction = token.createAssociatedTokenAccountInstruction(
        wallet.publicKey,
        tokenBTokenAccount,
        swapAuthority,
        tokenBMint
    );

    transaction.add(tokenAAccountInstruction);
    transaction.add(tokenBAccountInstruction);

    const sig = await connection.sendTransaction(transaction, [wallet, tokenSwapStateAccount]);
    console.log(sig);

    transaction = new Transaction();
    // this lp token is created and set the owner as `swapAuthority` address
    const poolTokenMint = new PublicKey('LPTuREAaGJpFirvsjF1Q5dgqjZwgFRDTC4HYD4V2Ym6');

    // create a associated pool token account to add initial liquidity to it for some security purpose
    const poolTokenAccount = loadKeypair('TAPrHismcGsw7h4kvKkXhAS1y35Wv1dMRyPNmjYRGtr.sjon');
    const poolAccountRent = await token.getMinimumBalanceForRentExemptAccount(connection);

    const createTokenAccountPoolInstruction = SystemProgram.createAccount({
        fromPubkey: wallet.publicKey,
        newAccountPubkey: poolTokenAccount.publicKey,
        space: token.ACCOUNT_SIZE,
        lamports: poolAccountRent,
        programId: token.TOKEN_PROGRAM_ID,
    })
    const initializeTokenAccountPoolInstruction = token.createInitializeAccountInstruction(
        poolTokenAccount.publicKey,
        poolTokenMint,
        wallet.publicKey
    )

    transaction.add(createTokenAccountPoolInstruction);
    transaction.add(initializeTokenAccountPoolInstruction)

    // token pool fee receiver account
    const feeOwner = new PublicKey('HfoTxFR1Tm6kGmWgYWD6J7YHVY1UwqSULUGVLXkJqaKN'); // who?, why?
    let tokenFeeAccountAddress = await token.getAssociatedTokenAddress(
        poolTokenMint, // mint
        feeOwner, // owner
        true // allow owner off curve
    )
    const tokenFeeAccountInstruction = token.createAssociatedTokenAccountInstruction(
        wallet.publicKey, // payer 
        tokenFeeAccountAddress, // fee receiver token account
        feeOwner,   // feeOwner, 
        poolTokenMint  // mint
    )
    transaction.add(tokenFeeAccountInstruction)

    // ----- CREATE SWAP POOL ----- //
    const tokenSwapInitSwapInstruction = TokenSwap.createInitSwapInstruction(
        tokenSwapStateAccount, 
        swapAuthority, 
        tokenATokenAccount, 
        tokenBTokenAccount, 
        poolTokenMint, 
        tokenFeeAccountAddress, 
        poolTokenAccount.publicKey,  // initial liquidity is minted to this account hwen swap pool is created
        token.TOKEN_PROGRAM_ID, 
        TOKEN_SWAP_PROGRAM_ID, 
        BigInt(0), 
        BigInt(100),
        BigInt(5), 
        BigInt(10000), 
        BigInt(5), 
        BigInt(100), 
        BigInt(1), 
        BigInt(100), 
        CurveType.ConstantProduct
    )
    
    transaction.add(tokenSwapInitSwapInstruction);

    const swapPoolCreateSignature = await connection.sendTransaction(transaction, [wallet, poolTokenAccount]);
}

main()