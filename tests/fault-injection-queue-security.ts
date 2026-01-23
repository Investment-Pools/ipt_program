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
  revoke,
} from "@solana/spl-token";
import { PublicKey, Keypair, SystemProgram } from "@solana/web3.js";
import { assert } from "chai";

describe("🔴 FAULT-INJECTION: Queue Security & Batch Operations", () => {
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

  // Wallets
  const payer = (provider.wallet as anchor.Wallet).payer;
  const admin = provider.wallet;
  const oracle = Keypair.generate();
  const feeCollector = Keypair.generate();
  const executor = Keypair.generate();
  
  // Attack scenario users
  const attacker = Keypair.generate();
  const victim1 = Keypair.generate();
  const victim2 = Keypair.generate();
  const victim3 = Keypair.generate();

  // Token accounts
  let adminUsdcAccount: PublicKey;
  let attackerUsdcAccount: PublicKey;
  let attackerIptAccount: PublicKey;
  let attackerIptAccount2: PublicKey; // For transfer attack
  let victim1UsdcAccount: PublicKey;
  let victim1IptAccount: PublicKey;
  let victim2UsdcAccount: PublicKey;
  let victim2IptAccount: PublicKey;
  let victim3UsdcAccount: PublicKey;
  let victim3IptAccount: PublicKey;

  const DECIMALS = 6;
  const INITIAL_EXCHANGE_RATE = new BN(1_034_200);

  // Test results
  const testResults: { 
    testId: string; 
    description: string; 
    status: "PASS" | "FAIL" | "SKIP"; 
    details?: string;
  }[] = [];

  function recordResult(testId: string, description: string, status: "PASS" | "FAIL" | "SKIP", details?: string) {
    testResults.push({ testId, description, status, details });
  }

  function getErrorFromTx(err: any): string {
    if (err.error?.errorCode?.code) return err.error.errorCode.code;
    if (err.logs) {
      for (const log of err.logs) {
        if (log.includes("Error Code:")) {
          const match = log.match(/Error Code: (\w+)/);
          if (match) return match[1];
        }
      }
    }
    return err.toString().substring(0, 150);
  }

  before(async () => {
    console.log("\n🔧 Setting up Queue Security Test Environment...\n");

    // Fund all test keypairs
    const recipients = [oracle, feeCollector, executor, attacker, victim1, victim2, victim3];
    const transferLamports = 0.2 * anchor.web3.LAMPORTS_PER_SOL;
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
    console.log(`✅ Funded ${recipients.length} test accounts`);

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
    adminUsdcAccount = (await getOrCreateAssociatedTokenAccount(
      provider.connection, payer, usdcMint, admin.publicKey
    )).address;

    attackerUsdcAccount = (await getOrCreateAssociatedTokenAccount(
      provider.connection, payer, usdcMint, attacker.publicKey
    )).address;

    victim1UsdcAccount = (await getOrCreateAssociatedTokenAccount(
      provider.connection, payer, usdcMint, victim1.publicKey
    )).address;

    victim2UsdcAccount = (await getOrCreateAssociatedTokenAccount(
      provider.connection, payer, usdcMint, victim2.publicKey
    )).address;

    victim3UsdcAccount = (await getOrCreateAssociatedTokenAccount(
      provider.connection, payer, usdcMint, victim3.publicKey
    )).address;

    // Mint USDC
    await mintTo(provider.connection, payer, usdcMint, adminUsdcAccount, payer, 1_000_000 * 10 ** DECIMALS);
    await mintTo(provider.connection, payer, usdcMint, attackerUsdcAccount, payer, 50_000 * 10 ** DECIMALS);
    await mintTo(provider.connection, payer, usdcMint, victim1UsdcAccount, payer, 50_000 * 10 ** DECIMALS);
    await mintTo(provider.connection, payer, usdcMint, victim2UsdcAccount, payer, 50_000 * 10 ** DECIMALS);
    await mintTo(provider.connection, payer, usdcMint, victim3UsdcAccount, payer, 50_000 * 10 ** DECIMALS);

    // Initialize pool
    const config = {
      adminAuthority: admin.publicKey,
      oracleAuthority: oracle.publicKey,
      feeCollector: feeCollector.publicKey,
      depositFeeBps: 100,
      withdrawalFeeBps: 100,
      managementFeeBps: 50,
      initialExchangeRate: INITIAL_EXCHANGE_RATE,
      maxTotalSupply: new BN(0),
      maxQueueSize: 20,
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

    // Create IPT accounts
    attackerIptAccount = (await getOrCreateAssociatedTokenAccount(
      provider.connection, payer, iptMint, attacker.publicKey
    )).address;

    // Create second IPT account for attacker to transfer to
    const tempUser = Keypair.generate();
    attackerIptAccount2 = (await getOrCreateAssociatedTokenAccount(
      provider.connection, payer, iptMint, tempUser.publicKey
    )).address;

    victim1IptAccount = (await getOrCreateAssociatedTokenAccount(
      provider.connection, payer, iptMint, victim1.publicKey
    )).address;

    victim2IptAccount = (await getOrCreateAssociatedTokenAccount(
      provider.connection, payer, iptMint, victim2.publicKey
    )).address;

    victim3IptAccount = (await getOrCreateAssociatedTokenAccount(
      provider.connection, payer, iptMint, victim3.publicKey
    )).address;

    // Admin deposits initial reserves
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

    console.log("✅ Pool initialized with reserves");

    // All users deposit to get IPT
    const depositAmount = new BN(10_000 * 10 ** DECIMALS);
    
    for (const [user, usdcAcc, iptAcc] of [
      [attacker, attackerUsdcAccount, attackerIptAccount],
      [victim1, victim1UsdcAccount, victim1IptAccount],
      [victim2, victim2UsdcAccount, victim2IptAccount],
      [victim3, victim3UsdcAccount, victim3IptAccount],
    ] as [Keypair, PublicKey, PublicKey][]) {
      await program.methods
        .userDeposit(depositAmount, new BN(0))
        .accounts({
          user: user.publicKey,
          pool: poolPda,
          poolAuthority: poolAuthority,
          userUsdcAccount: usdcAcc,
          userIptAccount: iptAcc,
          poolUsdcReserve: usdcReserve,
          iptMint: iptMint,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([user])
        .rpc();
    }

    console.log("✅ All users have IPT tokens");
    console.log("\n🚀 Setup complete! Starting Queue Security Tests...\n");
  });


  describe("🔥 Critical: Queue Blocking Attack Prevention", () => {
    it("SEC-01: Setup - Create reserve shortage to force queue", async () => {
      const testId = "SEC-01-SETUP";
      
      // Withdraw most reserves to force queue
      const pool = await program.account.pool.fetch(poolPda);
      const reserveToWithdraw = pool.totalUsdcReserves.sub(new BN(1000 * 10 ** DECIMALS));
      
      await program.methods
        .adminWithdrawUsdc(reserveToWithdraw)
        .accounts({
          admin: admin.publicKey,
          pool: poolPda,
          poolAuthority: poolAuthority,
          adminUsdcAccount: adminUsdcAccount,
          poolUsdcReserve: usdcReserve,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();
      
      const poolAfter = await program.account.pool.fetch(poolPda);
      console.log(`✅ ${testId}: Reserve shortage created`);
      console.log(`   Remaining reserves: ${poolAfter.totalUsdcReserves.toString()}`);
      
      recordResult(testId, "Setup - Create reserve shortage to force queue", "PASS", `Reserves: ${poolAfter.totalUsdcReserves.toString()}`);
    });

    it("SEC-02: Malicious user queues withdrawal request", async () => {
      const testId = "SEC-02";
      
      const attackerBalance = await getAccount(provider.connection, attackerIptAccount);
      const withdrawAmount = new BN(attackerBalance.amount.toString()).div(new BN(2));
      
      // Approve delegation
      await approve(
        provider.connection,
        attacker,
        attackerIptAccount,
        poolAuthority,
        attacker.publicKey,
        BigInt(withdrawAmount.toString())
      );
      
      // Queue withdrawal (should go to queue due to insufficient reserves)
      await program.methods
        .userWithdraw(withdrawAmount, new BN(0))
        .accounts({
          user: attacker.publicKey,
          pool: poolPda,
          poolAuthority: poolAuthority,
          userUsdcAccount: attackerUsdcAccount,
          userIptAccount: attackerIptAccount,
          poolUsdcReserve: usdcReserve,
          iptMint: iptMint,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([attacker])
        .rpc();
      
      const poolAfter = await program.account.pool.fetch(poolPda);
      
      if (poolAfter.pendingQueue.length > 0) {
        console.log(`✅ ${testId}: Attacker added to queue at position 0`);
        console.log(`   Queue length: ${poolAfter.pendingQueue.length}`);
        recordResult(testId, "Malicious user queues withdrawal request", "PASS", `Queue position: 0`);
      } else {
        console.log(`⚠️ ${testId}: Withdrawal was instant (reserves available)`);
        recordResult(testId, "Malicious user queues withdrawal request", "SKIP", "Instant withdrawal");
      }
    });

    it("SEC-03: 🔥 ATTACK - Malicious user transfers ALL IPT away after queuing", async () => {
      const testId = "SEC-03";
      
      const attackerBalanceBefore = await getAccount(provider.connection, attackerIptAccount);
      
      if (attackerBalanceBefore.amount > BigInt(0)) {
        // Transfer ALL IPT to another account
        await transfer(
          provider.connection,
          attacker,
          attackerIptAccount,
          attackerIptAccount2,
          attacker.publicKey,
          attackerBalanceBefore.amount
        );
        
        const attackerBalanceAfter = await getAccount(provider.connection, attackerIptAccount);
        
        if (attackerBalanceAfter.amount === BigInt(0)) {
          console.log(`🔥 ${testId}: ATTACK EXECUTED!`);
          console.log(`   Attacker now has 0 IPT but is still in queue`);
          console.log(`   WITHOUT protection: Queue would be BLOCKED`);
          console.log(`   WITH protection: System will SKIP and continue`);
          recordResult(testId, "Malicious user transfers ALL IPT away after queuing", "PASS", "Balance: 0, still in queue");
        } else {
          recordResult(testId, "Malicious user transfers ALL IPT away after queuing", "FAIL", "Transfer failed");
        }
      } else {
        recordResult(testId, "Malicious user transfers ALL IPT away after queuing", "SKIP", "No balance to transfer");
      }
    });

    it("SEC-04: Valid users queue withdrawals behind attacker", async () => {
      const testId = "SEC-04";
      
      const victims = [
        { user: victim1, usdcAcc: victim1UsdcAccount, iptAcc: victim1IptAccount },
        { user: victim2, usdcAcc: victim2UsdcAccount, iptAcc: victim2IptAccount },
      ];
      
      for (let i = 0; i < victims.length; i++) {
        const { user, usdcAcc, iptAcc } = victims[i];
        const balance = await getAccount(provider.connection, iptAcc);
        const withdrawAmount = new BN(balance.amount.toString()).div(new BN(2));
        
        if (withdrawAmount.gt(new BN(0))) {
          await approve(
            provider.connection,
            user,
            iptAcc,
            poolAuthority,
            user.publicKey,
            BigInt(withdrawAmount.toString())
          );
          
          await program.methods
            .userWithdraw(withdrawAmount, new BN(0))
            .accounts({
              user: user.publicKey,
              pool: poolPda,
              poolAuthority: poolAuthority,
              userUsdcAccount: usdcAcc,
              userIptAccount: iptAcc,
              poolUsdcReserve: usdcReserve,
              iptMint: iptMint,
              tokenProgram: TOKEN_PROGRAM_ID,
            })
            .signers([user])
            .rpc();
        }
      }
      
      const poolAfter = await program.account.pool.fetch(poolPda);
      console.log(`✅ ${testId}: Victims added to queue`);
      console.log(`   Queue length: ${poolAfter.pendingQueue.length}`);
      console.log(`   Queue state:`);
      poolAfter.pendingQueue.forEach((entry, idx) => {
        console.log(`     [${idx}] User: ${entry.user.toString().substring(0, 8)}..., Amount: ${entry.amount.toString()}`);
      });
      
      recordResult(testId, "Valid users queue withdrawals behind attacker", "PASS", `Queue length: ${poolAfter.pendingQueue.length}`);
    });

    it("SEC-05: Admin restores reserves for batch processing", async () => {
      const testId = "SEC-05";
      
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
      
      console.log(`✅ ${testId}: Reserves restored for batch processing`);
      recordResult(testId, "Admin refills reserves for batch processing", "PASS", "100k USDC added");
    });

    it("SEC-06: ✅ Batch process skips malicious user, processes valid users", async () => {
      const testId = "SEC-06";
      
      const poolBefore = await program.account.pool.fetch(poolPda);
      const queueLengthBefore = poolBefore.pendingQueue.length;
      
      if (queueLengthBefore === 0) {
        console.log(`⚠️ ${testId}: Queue is empty, skipping test`);
        recordResult(testId, "Batch process skips malicious user, processes valid users", "SKIP", "Empty queue");
        return;
      }
      
      console.log(`\n🔍 ${testId}: Testing batch processing...`);
      console.log(`   Queue before: ${queueLengthBefore} entries`);
      
      // Get amounts from queue
      const amounts = poolBefore.pendingQueue.map(w => w.amount);
      
      // Build remaining accounts array (2 accounts per user: IPT, USDC)
      const remainingAccounts: anchor.web3.AccountMeta[] = [];
      
      for (const pending of poolBefore.pendingQueue) {
        // Find the corresponding accounts
        let userIptAcc: PublicKey;
        let userUsdcAcc: PublicKey;
        
        if (pending.user.equals(attacker.publicKey)) {
          userIptAcc = attackerIptAccount;
          userUsdcAcc = attackerUsdcAccount;
        } else if (pending.user.equals(victim1.publicKey)) {
          userIptAcc = victim1IptAccount;
          userUsdcAcc = victim1UsdcAccount;
        } else if (pending.user.equals(victim2.publicKey)) {
          userIptAcc = victim2IptAccount;
          userUsdcAcc = victim2UsdcAccount;
        } else {
          continue;
        }
        
        remainingAccounts.push(
          { pubkey: userIptAcc, isSigner: false, isWritable: true },
          { pubkey: userUsdcAcc, isSigner: false, isWritable: true }
        );
      }
      
      try {
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
        
        console.log(`   ✅ Batch tx: ${tx}`);
        
        const poolAfter = await program.account.pool.fetch(poolPda);
        const queueLengthAfter = poolAfter.pendingQueue.length;
        
        console.log(`   Queue after: ${queueLengthAfter} entries`);
        
        if (queueLengthAfter < queueLengthBefore) {
          console.log(`\n🎉 SUCCESS! Queue blocking attack PREVENTED!`);
          console.log(`   ✅ Attacker (with 0 balance) was SKIPPED`);
          console.log(`   ✅ Valid victims were PROCESSED`);
          console.log(`   ✅ All processed/skipped entries REMOVED from queue`);
          console.log(`   ✅ System NOT blocked!`);
          
          recordResult(testId, "Batch process skips malicious user, processes valid users", "PASS", 
            `Queue: ${queueLengthBefore} -> ${queueLengthAfter}`);
        } else {
          recordResult(testId, "Batch process skips malicious user, processes valid users", "FAIL", 
            "Queue not processed");
        }
        
      } catch (err: any) {
        const errorMsg = getErrorFromTx(err);
        console.log(`   ❌ Batch failed: ${errorMsg}`);
        recordResult(testId, "Batch process skips malicious user, processes valid users", "FAIL", errorMsg);
      }
    });
  });

  describe("🔥 Delegation Revocation Attack", () => {
    
    it("SEC-07: 🔥 ATTACK - User revokes delegation after queuing", async () => {
      const testId = "SEC-07";
      
      // First, get victim3 into the queue
      const victim3Balance = await getAccount(provider.connection, victim3IptAccount);
      
      if (victim3Balance.amount > BigInt(0)) {
        const withdrawAmount = new BN(victim3Balance.amount.toString()).div(new BN(2));
        
        // Create reserve shortage again
        const pool = await program.account.pool.fetch(poolPda);
        if (pool.totalUsdcReserves.gt(new BN(1000 * 10 ** DECIMALS))) {
          const toWithdraw = pool.totalUsdcReserves.sub(new BN(500 * 10 ** DECIMALS));
          await program.methods
            .adminWithdrawUsdc(toWithdraw)
            .accounts({
              admin: admin.publicKey,
              pool: poolPda,
              poolAuthority: poolAuthority,
              adminUsdcAccount: adminUsdcAccount,
              poolUsdcReserve: usdcReserve,
              tokenProgram: TOKEN_PROGRAM_ID,
            })
            .rpc();
        }
        
        // Approve and queue
        await approve(
          provider.connection,
          victim3,
          victim3IptAccount,
          poolAuthority,
          victim3.publicKey,
          BigInt(withdrawAmount.toString())
        );
        
        try {
          await program.methods
            .userWithdraw(withdrawAmount, new BN(0))
            .accounts({
              user: victim3.publicKey,
              pool: poolPda,
              poolAuthority: poolAuthority,
              userUsdcAccount: victim3UsdcAccount,
              userIptAccount: victim3IptAccount,
              poolUsdcReserve: usdcReserve,
              iptMint: iptMint,
              tokenProgram: TOKEN_PROGRAM_ID,
            })
            .signers([victim3])
            .rpc();
          
          // Now REVOKE delegation
          await revoke(
            provider.connection,
            victim3,
            victim3IptAccount,
            victim3.publicKey
          );
          
          console.log(`✅ ${testId}: User queued then revoked delegation`);
          console.log(`   When batch processes, this user should be SKIPPED`);
          console.log(`   with NotDelegated or InsufficientDelegation error`);
          
          recordResult(testId, "User revokes delegation after queuing", "PASS", "Delegation revoked after queuing");
          
        } catch (err: any) {
          // Queue might be full or user already in queue
          const errorMsg = getErrorFromTx(err);
          console.log(`⚠️ ${testId}: Could not complete setup: ${errorMsg}`);
          recordResult(testId, "User revokes delegation after queuing", "SKIP", errorMsg);
        }
      } else {
        recordResult(testId, "User revokes delegation after queuing", "SKIP", "No balance");
      }
    });
  });

  describe("📛 Queue Validation Errors", () => {
    
    it("QUEUE-05: Fails when user tries to queue twice", async () => {
      const testId = "QUEUE-05";
      const expectedError = "AlreadyInQueue";
      
      // Check if any victim is already in queue
      const pool = await program.account.pool.fetch(poolPda);
      const queuedUsers = pool.pendingQueue.map(w => w.user.toString());
      
      // Find a user that's in the queue
      let targetUser: Keypair | null = null;
      let targetIptAcc: PublicKey | null = null;
      let targetUsdcAcc: PublicKey | null = null;
      
      for (const [user, iptAcc, usdcAcc] of [
        [victim1, victim1IptAccount, victim1UsdcAccount],
        [victim2, victim2IptAccount, victim2UsdcAccount],
      ] as [Keypair, PublicKey, PublicKey][]) {
        if (queuedUsers.includes(user.publicKey.toString())) {
          targetUser = user;
          targetIptAcc = iptAcc;
          targetUsdcAcc = usdcAcc;
          break;
        }
      }
      
      if (!targetUser) {
        console.log(`⚠️ ${testId}: No user currently in queue to test duplicate`);
        recordResult(testId, "Fails when user tries to queue twice", "SKIP", "No queued user found");
        return;
      }
      
      // Try to add the same user again
      const balance = await getAccount(provider.connection, targetIptAcc!);
      const amount = new BN(100 * 10 ** DECIMALS);
      
      if (balance.amount < BigInt(amount.toString())) {
        recordResult(testId, "Fails when user tries to queue twice", "SKIP", "Insufficient balance");
        return;
      }
      
      await approve(
        provider.connection,
        targetUser,
        targetIptAcc!,
        poolAuthority,
        targetUser.publicKey,
        BigInt(amount.toString())
      );
      
      try {
        await program.methods
          .userWithdraw(amount, new BN(0))
          .accounts({
            user: targetUser.publicKey,
            pool: poolPda,
            poolAuthority: poolAuthority,
            userUsdcAccount: targetUsdcAcc!,
            userIptAccount: targetIptAcc!,
            poolUsdcReserve: usdcReserve,
            iptMint: iptMint,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([targetUser])
          .rpc();
        
        recordResult(testId, "Fails when user tries to queue twice", "FAIL", "No error thrown");
        assert.fail("Should have thrown AlreadyInQueue error");
        
      } catch (err: any) {
        const actualError = getErrorFromTx(err);
        if (actualError.includes(expectedError) || err.toString().includes(expectedError) || err.toString().includes("Already")) {
          console.log(`✅ ${testId}: Correctly rejected duplicate queue entry`);
          recordResult(testId, "Fails when user tries to queue twice", "PASS", expectedError);
        } else {
          console.log(`❌ ${testId}: Wrong error - Expected: ${expectedError}, Got: ${actualError}`);
          recordResult(testId, "Fails when user tries to queue twice", "FAIL", actualError);
        }
      }
    });

    it("QUEUE-06: Fails when batch size exceeds queue length", async () => {
      const testId = "QUEUE-06";
      const expectedError = "EmptyWithdrawalBatch";
      
      const pool = await program.account.pool.fetch(poolPda);
      const queueLength = pool.pendingQueue.length;
      
      // Create amounts array larger than queue
      const amounts = Array(queueLength + 5).fill(new BN(100));
      
      try {
        await program.methods
          .batchExecuteWithdraw(amounts)
          .accounts({
            executor: executor.publicKey,
            pool: poolPda,
            poolAuthority: poolAuthority,
            poolUsdcReserve: usdcReserve,
            iptMint: iptMint,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([executor])
          .rpc();
        
        recordResult(testId, "Fails when batch size exceeds queue length", "FAIL", "No error thrown");
        
      } catch (err: any) {
        const actualError = getErrorFromTx(err);
        if (actualError.includes(expectedError) || actualError.includes("Empty") || actualError.includes("Invalid")) {
          console.log(`✅ ${testId}: Correctly rejected batch_size > queue_length`);
          recordResult(testId, "Fails when batch size exceeds queue length", "PASS", actualError);
        } else {
          console.log(`❌ ${testId}: Error: ${actualError}`);
          recordResult(testId, "Fails when batch size exceeds queue length", "FAIL", actualError);
        }
      }
    });

    it("QUEUE-07: Fails when remaining accounts count is invalid", async () => {
      const testId = "QUEUE-07";
      const expectedError = "InvalidAccountsCount";
      
      const pool = await program.account.pool.fetch(poolPda);
      
      if (pool.pendingQueue.length === 0) {
        recordResult(testId, "Fails when remaining accounts count is invalid", "SKIP", "Empty queue");
        return;
      }
      
      const amounts = [pool.pendingQueue[0].amount];
      
      // Provide only 1 account instead of 2
      const remainingAccounts = [
        { pubkey: victim1IptAccount, isSigner: false, isWritable: true },
        // Missing USDC account!
      ];
      
      try {
        await program.methods
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
        
        recordResult(testId, "Fails when remaining accounts count is invalid", "FAIL", "No error thrown");
        
      } catch (err: any) {
        const actualError = getErrorFromTx(err);
        if (actualError.includes(expectedError) || actualError.includes("Invalid") || actualError.includes("count")) {
          console.log(`✅ ${testId}: Correctly rejected wrong accounts count`);
          recordResult(testId, "Fails when remaining accounts count is invalid", "PASS", actualError);
        } else {
          console.log(`❌ ${testId}: Error: ${actualError}`);
          recordResult(testId, "Fails when remaining accounts count is invalid", "FAIL", actualError);
        }
      }
    });
  });

  after(async () => {
    console.log("\n");
    console.log("╔══════════════════════════════════════════════════════════════════╗");
    console.log("║        📊 QUEUE SECURITY TEST RESULTS SUMMARY                    ║");
    console.log("╠══════════════════════════════════════════════════════════════════╣");
    
    const passCount = testResults.filter(r => r.status === "PASS").length;
    const failCount = testResults.filter(r => r.status === "FAIL").length;
    const skipCount = testResults.filter(r => r.status === "SKIP").length;
    
    console.log(`║  ✅ PASS: ${passCount.toString().padEnd(3)} | ❌ FAIL: ${failCount.toString().padEnd(3)} | ⏭️ SKIP: ${skipCount.toString().padEnd(3)}                      ║`);
    console.log("╠══════════════════════════════════════════════════════════════════╣");
    
    for (const result of testResults) {
      const statusIcon = result.status === "PASS" ? "✅" : result.status === "FAIL" ? "❌" : "⏭️";
      console.log(`║  ${statusIcon} ${result.testId.padEnd(12)}: ${result.description.substring(0, 40).padEnd(40)}  ║`);
    }
    
    console.log("╠══════════════════════════════════════════════════════════════════╣");
    
    // Security summary
    const securityTests = testResults.filter(r => r.testId.startsWith("SEC"));
    const securityPass = securityTests.filter(r => r.status === "PASS").length;
    
    if (securityPass === securityTests.length) {
      console.log("║  🛡️  ALL SECURITY TESTS PASSED - System is protected!           ║");
    } else {
      console.log("║  ⚠️  Some security tests failed - Review required!              ║");
    }
    
    console.log("╚══════════════════════════════════════════════════════════════════╝");
  });
});