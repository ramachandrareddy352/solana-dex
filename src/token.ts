import dotenv from "dotenv";
import {
  createMint,
  getMint,
  getOrCreateAssociatedTokenAccount,
  getAccount,
  mintTo,
  setAuthority,
  AuthorityType,
  transfer,
} from "@solana/spl-token";
import {
  clusterApiUrl,
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
} from "@solana/web3.js";

dotenv.config();

class TokenData {
  tokenAddress: PublicKey;
  tokenAccount: PublicKey;

  constructor(tokenAddress: PublicKey, tokenAccount: PublicKey) {
    this.tokenAddress = tokenAddress;
    this.tokenAccount = tokenAccount;
  }
}

async function createNewToken(connection: Connection, signer: Keypair, totalSupply: number): Promise<TokenData> {
  const mintAuthority = Keypair.generate();

  const mint = await createMint(
    connection,
    signer,
    mintAuthority.publicKey,
    null,
    9 // We are using 9 to match the CLI decimal default exactly
  );

  console.log("Our token address is:", mint.toBase58());

  const mintInfo = await getMint(connection, mint);

  console.log("The initial supply of tokens is:", mintInfo.supply);

  const tokenAccount = await getOrCreateAssociatedTokenAccount(
    connection,
    signer,
    mint,
    signer.publicKey
  );

  console.log("Our new associated token account is:", tokenAccount.address.toBase58());
  console.log(`Our new associated token account has ${tokenAccount.amount} tokens`);

  await mintTo(connection, signer, mint, tokenAccount.address, mintAuthority, totalSupply);

  const updatedTokenAccountInfo = await getAccount(connection, tokenAccount.address);
  const updatedMintInfo = await getMint(connection, mint);

  console.log(`The associated account ${tokenAccount.address.toBase58()} now has ${updatedTokenAccountInfo.amount} tokens`);
  console.log(`The total supply of ${mintInfo.address.toBase58()} is now ${updatedMintInfo.supply}`);

  setAuthority(
    connection,
    signer,
    mint,
    mintAuthority,
    AuthorityType.MintTokens,
    null
  );

  const receiver = Keypair.generate();
  const receiverTokenAccount = await getOrCreateAssociatedTokenAccount(
    connection,
    signer,
    mint,
    receiver.publicKey
  );

  const test = await transfer(
    connection,
    signer,
    tokenAccount.address,
    receiverTokenAccount.address,
    signer,
    totalSupply / 2
  );

  const newTokenAccountInfo = await getAccount(
    connection,
    tokenAccount.address
  );

  console.log(
    `The sender account ${tokenAccount.address.toBase58()} now has ${
      newTokenAccountInfo.amount
    } tokens`
  );

  const receiverTokenAccountInfo = await getAccount(
    connection,
    receiverTokenAccount.address
  );

  console.log(
    `The receiver account ${receiverTokenAccount.address.toBase58()} now has ${
      receiverTokenAccountInfo.amount
    } tokens`
  );

  return new TokenData(mint, tokenAccount.address);
}

async function main() {
  const secret = JSON.parse(process.env.PRIVATE_KEY ?? "") as number[];
  const secretKey = Uint8Array.from(secret);
  const owner = Keypair.fromSecretKey(secretKey);

  const connection = new Connection(clusterApiUrl("devnet"), "confirmed");

  const totalSupply = 1000000000;
  const tokenData = await createNewToken(connection, owner, totalSupply);

  console.log(
    `Our new token is ${tokenData.tokenAddress.toBase58()} with a total supply (${totalSupply}) half in token account ${tokenData.tokenAccount.toBase58()}`
  );
}

main().then(() => {
  process.exit();
});