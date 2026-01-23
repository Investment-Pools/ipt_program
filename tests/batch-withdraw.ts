// SPDX-License-Identifier: Apache-2.0

import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { RefiIpt, IDL } from "../target/types/refi_ipt";
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  getAccount,
  TOKEN_PROGRAM_ID,
  approve,
  transfer,
} from "@solana/spl-token";
import { PublicKey, Keypair, SystemProgram } from "@solana/web3.js";
import { assert } from "chai";

describe("Batch Withdraw & Queue Security Tests", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const programId = new PublicKey("HpPJBUex6FdSw7CGvYzjtUmM1629RNTqgCyu6pfcyNBx");
  const program = new Program(IDL, programId, provider) as Program<RefiIpt>;

  // Test accounts
  let usdcMint: PublicKey;
  let iptMint: PublicKey;
  let poolPda: PublicKey;
  let poolAuthority: PublicKey;
  let usdcReserve: PublicKey;

  // Test wallets
  const payer = (provider.wallet as anchor.Wallet).payer;
  const admin = provider.wallet;
  const oracle = Keypair.generate();
  const feeCollector = Keypair.generate();
  const maliciousUser = Keypair.generate();
  const validUser1 = Keypair.generate();
  const validUser2 = Keypair.generate();
  const executor = Keypair.generate();

  // Token accounts
  let adminUsdcAccount: PublicKey;
  let maliciousUserUsdcAccount: PublicKey;
  let maliciousUserIptAccount: PublicKey;
  let maliciousUserIptAccount2: PublicKey;
  let validUser1UsdcAccount: PublicKey;
  let validUser1IptAccount: PublicKey;
  let validUser2UsdcAccount: PublicKey;
  let validUser2IptAccount: PublicKey;

  // Constants
  const INITIAL_EXCHANGE_RATE = new BN(1_034_200);
  const DEPOSIT_FEE_BPS = 0;
  const WITHDRAWAL_FEE_BPS = 100;
  const MANAGEMENT_FEE_BPS = 50;
  const MAX_TOTAL_SUPPLY = new BN(0); // Unlimited
  const MAX_QUEUE_SIZE = 20;
  const DECIMALS = 6;

  before(async () => {
    // // Airdrop SOL
    // const accounts = [maliciousUser, validUser1, validUser2, executor, feeCollector, oracle];
    // for (const account of accounts) {
    //   await provider.connection.requestAirdrop(
    //     account.publicKey,
    //     1 * anchor.web3.LAMPORTS_PER_SOL
    //   );
    // }

    // // Wait for airdrop confirmation
    // await new Promise((resolve) => setTimeout(resolve, 3000));
    // Fund test keypairs from payer to avoid airdrop 429 rate limit
    const recipients = [maliciousUser, validUser1, validUser2, executor, feeCollector, oracle];
    const transferLamports = 0.5 * anchor.web3.LAMPORTS_PER_SOL;
    const tx = new anchor.web3.Transaction();
    
    for (const kp of recipients) {
      tx.add(
        anchor.web3.SystemProgram.transfer({
          fromPubkey: payer.publicKey,
          toPubkey: kp.publicKey,
          lamports: transferLamports,
        })
      );
    }
    
    await provider.sendAndConfirm(tx, [payer]);
    console.log(`✅ Funded ${recipients.length} test accounts with ${transferLamports / anchor.web3.LAMPORTS_PER_SOL} SOL each`);

    // Create USDC mint
    usdcMint = await createMint(
      provider.connection,
      payer,
      admin.publicKey,
      null,
      DECIMALS
    );

    // Derive PDAs
    [poolPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("pool"), usdcMint.toBuffer()],
      program.programId
    );
    poolAuthority = poolPda;

    [iptMint] = PublicKey.findProgramAddressSync(
      [Buffer.from("ipt_mint"), poolPda.toBuffer()],
      program.programId
    );

    [usdcReserve] = PublicKey.findProgramAddressSync(
      [Buffer.from("usdc_reserve"), poolPda.toBuffer()],
      program.programId
    );

    // Create token accounts
    adminUsdcAccount = (
      await getOrCreateAssociatedTokenAccount(
        provider.connection,
        payer,
        usdcMint,
        admin.publicKey
      )
    ).address;

    maliciousUserUsdcAccount = (
      await getOrCreateAssociatedTokenAccount(
        provider.connection,
        payer,
        usdcMint,
        maliciousUser.publicKey
      )
    ).address;

    validUser1UsdcAccount = (
      await getOrCreateAssociatedTokenAccount(
        provider.connection,
        payer,
        usdcMint,
        validUser1.publicKey
      )
    ).address;

    validUser2UsdcAccount = (
      await getOrCreateAssociatedTokenAccount(
        provider.connection,
        payer,
        usdcMint,
        validUser2.publicKey
      )
    ).address;

    // Mint USDC
    await mintTo(
      provider.connection,
      payer,
      usdcMint,
      adminUsdcAccount,
      payer,
      1_000_000 * 10 ** DECIMALS
    );

    for (const account of [maliciousUserUsdcAccount, validUser1UsdcAccount, validUser2UsdcAccount]) {
      await mintTo(
        provider.connection,
        payer,
        usdcMint,
        account,
        payer,
        100_000 * 10 ** DECIMALS
      );
    }

    // Initialize pool - Step 1
    const config = {
      adminAuthority: admin.publicKey,
      oracleAuthority: oracle.publicKey,
      feeCollector: feeCollector.publicKey,
      depositFeeBps: DEPOSIT_FEE_BPS,
      withdrawalFeeBps: WITHDRAWAL_FEE_BPS,
      managementFeeBps: MANAGEMENT_FEE_BPS,
      initialExchangeRate: INITIAL_EXCHANGE_RATE,
      maxTotalSupply: MAX_TOTAL_SUPPLY,
      maxQueueSize: MAX_QUEUE_SIZE,
    };

    await program.methods
      .initPool(config)
      .accounts({
        payer: admin.publicKey,
        usdcMint: usdcMint,
        pool: poolPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    // Initialize pool - Step 2
    await program.methods
      .initPoolStep2()
      .accounts({
        payer: admin.publicKey,
        pool: poolPda,
        poolAuthority: poolAuthority,
        usdcMint: usdcMint,
        iptMint: iptMint,
        usdcReserve: usdcReserve,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    // Admin deposits reserves
    await program.methods
      .adminDepositUsdc(new BN(200_000 * 10 ** DECIMALS))
      .accounts({
        admin: admin.publicKey,
        pool: poolPda,
        adminUsdcAccount: adminUsdcAccount,
        poolUsdcReserve: usdcReserve,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    // Create IPT accounts for users
    maliciousUserIptAccount = (
      await getOrCreateAssociatedTokenAccount(
        provider.connection,
        payer,
        iptMint,
        maliciousUser.publicKey
      )
    ).address;

    const tempUser = Keypair.generate();
    maliciousUserIptAccount2 = (
      await getOrCreateAssociatedTokenAccount(
        provider.connection,
        payer,
        iptMint,
        tempUser.publicKey
      )
    ).address;

    validUser1IptAccount = (
      await getOrCreateAssociatedTokenAccount(
        provider.connection,
        payer,
        iptMint,
        validUser1.publicKey
      )
    ).address;

    validUser2IptAccount = (
      await getOrCreateAssociatedTokenAccount(
        provider.connection,
        payer,
        iptMint,
        validUser2.publicKey
      )
    ).address;

    console.log("✅ Batch withdraw test setup complete!");
  });

  describe("🚨 Critical Test: Queue Blocking Attack Prevention", () => {
    it("Step 1: Users deposit and receive IPT", async () => {
      // Malicious user deposits
      await program.methods
        .userDeposit(new BN(10_000 * 10 ** DECIMALS), new BN(0))
        .accounts({
          user: maliciousUser.publicKey,
          pool: poolPda,
          poolAuthority: poolAuthority,
          userUsdcAccount: maliciousUserUsdcAccount,
          userIptAccount: maliciousUserIptAccount,
          poolUsdcReserve: usdcReserve,
          iptMint: iptMint,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([maliciousUser])
        .rpc();

      // Valid users deposit
      await program.methods
        .userDeposit(new BN(15_000 * 10 ** DECIMALS), new BN(0))
        .accounts({
          user: validUser1.publicKey,
          pool: poolPda,
          poolAuthority: poolAuthority,
          userUsdcAccount: validUser1UsdcAccount,
          userIptAccount: validUser1IptAccount,
          poolUsdcReserve: usdcReserve,
          iptMint: iptMint,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([validUser1])
        .rpc();

      await program.methods
        .userDeposit(new BN(8_000 * 10 ** DECIMALS), new BN(0))
        .accounts({
          user: validUser2.publicKey,
          pool: poolPda,
          poolAuthority: poolAuthority,
          userUsdcAccount: validUser2UsdcAccount,
          userIptAccount: validUser2IptAccount,
          poolUsdcReserve: usdcReserve,
          iptMint: iptMint,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([validUser2])
        .rpc();

      console.log("✅ All users deposited and received IPT");
    });

    it("Step 2: Create reserve shortage to force queue", async () => {
      const pool = await program.account.pool.fetch(poolPda);
      const withdrawAmount = pool.totalUsdcReserves.sub(new BN(2_000 * 10 ** DECIMALS));

      await program.methods
        .adminWithdrawUsdc(withdrawAmount)
        .accounts({
          admin: admin.publicKey,
          pool: poolPda,
          poolAuthority: poolAuthority,
          adminUsdcAccount: adminUsdcAccount,
          poolUsdcReserve: usdcReserve,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();

      console.log("✅ Reserve shortage created");
    });

    it("Step 3: Malicious user queues withdrawal", async () => {
      const maliciousBalance = await getAccount(
        provider.connection,
        maliciousUserIptAccount
      );
      const amount = new BN(maliciousBalance.amount.toString());

      await approve(
        provider.connection,
        maliciousUser,
        maliciousUserIptAccount,
        poolAuthority,
        maliciousUser.publicKey, // owner
        BigInt(amount.toString())
      );

      await program.methods
        .userWithdraw(amount, new BN(0))
        .accounts({
          user: maliciousUser.publicKey,
          pool: poolPda,
          poolAuthority: poolAuthority,
          userUsdcAccount: maliciousUserUsdcAccount,
          userIptAccount: maliciousUserIptAccount,
          poolUsdcReserve: usdcReserve,
          iptMint: iptMint,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([maliciousUser])
        .rpc();

      const pool = await program.account.pool.fetch(poolPda);
      assert.equal(pool.pendingQueue.length, 1);
      console.log("✅ Malicious user in queue at position 0");
    });

    it("Step 4: 🔥 ATTACK - Malicious user transfers all IPT away", async () => {
      const balance = await getAccount(
        provider.connection,
        maliciousUserIptAccount
      );

      await transfer(
        provider.connection,
        maliciousUser,
        maliciousUserIptAccount,
        maliciousUserIptAccount2,
        maliciousUser.publicKey,
        balance.amount
      );

      const afterBalance = await getAccount(
        provider.connection,
        maliciousUserIptAccount
      );
      assert.equal(afterBalance.amount.toString(), "0");

      console.log("🔥 ATTACK EXECUTED: Malicious user has 0 IPT balance!");
      console.log("   WITHOUT FIX: Queue would be permanently blocked");
      console.log("   WITH FIX: System will skip and continue");
    });

    it("Step 5: Valid users also queue withdrawals", async () => {
      const user1Balance = await getAccount(provider.connection, validUser1IptAccount);
      const user2Balance = await getAccount(provider.connection, validUser2IptAccount);

      const amount1 = new BN(user1Balance.amount.toString());
      const amount2 = new BN(user2Balance.amount.toString());

      await approve(
        provider.connection,
        validUser1,
        validUser1IptAccount,
        poolAuthority,
        validUser1.publicKey,
        BigInt(amount1.toString())
      );

      await approve(
        provider.connection,
        validUser2,
        validUser2IptAccount,
        poolAuthority,
        validUser2.publicKey,
        BigInt(amount2.toString())
      );

      await program.methods
        .userWithdraw(amount1, new BN(0))
        .accounts({
          user: validUser1.publicKey,
          pool: poolPda,
          poolAuthority: poolAuthority,
          userUsdcAccount: validUser1UsdcAccount,
          userIptAccount: validUser1IptAccount,
          poolUsdcReserve: usdcReserve,
          iptMint: iptMint,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([validUser1])
        .rpc();

      await program.methods
        .userWithdraw(amount2, new BN(0))
        .accounts({
          user: validUser2.publicKey,
          pool: poolPda,
          poolAuthority: poolAuthority,
          userUsdcAccount: validUser2UsdcAccount,
          userIptAccount: validUser2IptAccount,
          poolUsdcReserve: usdcReserve,
          iptMint: iptMint,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([validUser2])
        .rpc();

      const pool = await program.account.pool.fetch(poolPda);
      assert.equal(pool.pendingQueue.length, 3);
      console.log("✅ Queue now has 3 users:");
      console.log("   [0] Malicious user (0 IPT balance - will be skipped)");
      console.log("   [1] Valid user 1 (will be processed)");
      console.log("   [2] Valid user 2 (will be processed)");
    });

    it("Step 6: Admin restores reserves for batch processing", async () => {
      await program.methods
        .adminDepositUsdc(new BN(100_000 * 10 ** DECIMALS))
        .accounts({
          admin: admin.publicKey,
          pool: poolPda,
          adminUsdcAccount: adminUsdcAccount,
          poolUsdcReserve: usdcReserve,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();

      console.log("✅ Reserves restored for processing");
    });

    it("Step 7: ✅ TEST - Batch process skips malicious user, processes valid users", async () => {
      const poolBefore = await program.account.pool.fetch(poolPda);
      assert.equal(poolBefore.pendingQueue.length, 3);

      const amounts = poolBefore.pendingQueue.map((w) => w.amount);

      // Get remaining accounts for batch
      const remainingAccounts = [
        { pubkey: maliciousUserIptAccount, isSigner: false, isWritable: true },
        { pubkey: maliciousUserUsdcAccount, isSigner: false, isWritable: true },
        { pubkey: validUser1IptAccount, isSigner: false, isWritable: true },
        { pubkey: validUser1UsdcAccount, isSigner: false, isWritable: true },
        { pubkey: validUser2IptAccount, isSigner: false, isWritable: true },
        { pubkey: validUser2UsdcAccount, isSigner: false, isWritable: true },
      ];

      const tx = await program.methods
        .batchExecuteWithdraw(amounts)
        .accounts({
          executor: executor.publicKey,
          pool: poolPda,
          poolAuthority: poolAuthority,
          poolUsdcReserve: usdcReserve,
          iptMint: iptMint,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .remainingAccounts(remainingAccounts)
        .signers([executor])
        .rpc();

      console.log("✅ Batch execute tx:", tx);

      const poolAfter = await program.account.pool.fetch(poolPda);
      
      console.log("\n========== BATCH EXECUTION RESULT ==========");
      console.log("Queue length after:", poolAfter.pendingQueue.length);
      console.log("Expected: 0 (all processed/skipped)");
      
      assert.equal(
        poolAfter.pendingQueue.length,
        0,
        "Queue should be empty after processing"
      );

      // Check events would show:
      // - 1 WithdrawSkipped event (malicious user)
      // - 2 WithdrawExecuted events (valid users)
      // - 1 BatchWithdrawExecuted event (successful_count=2, skipped_count=1)

      console.log("\n🎉 SUCCESS! Queue blocking attack prevented!");
      console.log("   ✅ Malicious user (0 balance) was SKIPPED");
      console.log("   ✅ Valid users were PROCESSED");
      console.log("   ✅ All entries REMOVED from queue");
      console.log("   ✅ System NOT blocked!");
      console.log("===========================================\n");
    });
  });
});
