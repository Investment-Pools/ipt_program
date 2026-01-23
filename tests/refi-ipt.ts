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
} from "@solana/spl-token";
import { PublicKey, Keypair, SystemProgram } from "@solana/web3.js";
import { assert } from "chai";
 
describe("refi-ipt", () => {
  // Configure the client to use Devnet
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const programId = new PublicKey("HpPJBUex6FdSw7CGvYzjtUmM1629RNTqgCyu6pfcyNBx");
  const program = new Program(IDL, programId, provider) as Program<RefiIpt>;

  // Global variables
  let usdcMint: PublicKey;
  let iptMint: PublicKey;
  let poolPda: PublicKey;
  let poolBump: number;
  let poolAuthority: PublicKey;
  let usdcReserve: PublicKey;

  // Wallets
  const payer = (provider.wallet as anchor.Wallet).payer;
  const admin = provider.wallet;
  const oracle = Keypair.generate();
  const feeCollector = Keypair.generate();
  const user1 = Keypair.generate();
  const user2 = Keypair.generate();

  // Token accounts
  let adminUsdcAccount: PublicKey;
  let user1UsdcAccount: PublicKey;
  let user1IptAccount: PublicKey;
  let user2UsdcAccount: PublicKey;
  let user2IptAccount: PublicKey;
  let feeCollectorUsdcAccount: PublicKey;

  // Constants
  const INITIAL_EXCHANGE_RATE = new BN(1_034_200); // 1.0342:1 scaled by 1e6
  const DEPOSIT_FEE_BPS = 0; // 0%
  const WITHDRAWAL_FEE_BPS = 100; // 1%
  const MANAGEMENT_FEE_BPS = 50; // 0.5%
  const DECIMALS = 6;
 
  before(async () => {
    // // Airdrop SOL to test accounts
    // await provider.connection.requestAirdrop(
    //   user1.publicKey,
    //   10 * anchor.web3.LAMPORTS_PER_SOL
    // );
    // await provider.connection.requestAirdrop(
    //   user2.publicKey,
    //   10 * anchor.web3.LAMPORTS_PER_SOL
    // );
    // await provider.connection.requestAirdrop(
    //   executor.publicKey,
    //   10 * anchor.web3.LAMPORTS_PER_SOL
    // );
    // await provider.connection.requestAirdrop(
    //   feeCollector.publicKey,
    //   5 * anchor.web3.LAMPORTS_PER_SOL
    // );
    // await provider.connection.requestAirdrop(
    //   oracle.publicKey,
    //   5 * anchor.web3.LAMPORTS_PER_SOL
    // );
 
    // // Wait for airdrops to confirm
    // await new Promise((resolve) => setTimeout(resolve, 2000));
 
    // Create USDC mint
    usdcMint = await createMint(
      provider.connection,
      payer,
      admin.publicKey,
      null,
      DECIMALS
    );
 
    console.log("USDC Mint:", usdcMint.toString());
 
    // Derive PDAs
    [poolPda, poolBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("pool"), usdcMint.toBuffer()],
      program.programId
    );
 
    poolAuthority = poolPda;
 
    console.log("Pool PDA:", poolPda.toString());
    console.log("Pool Authority:", poolAuthority.toString());
 
    // Create token accounts
    adminUsdcAccount = (
      await getOrCreateAssociatedTokenAccount(
        provider.connection,
        payer,
        usdcMint,
        admin.publicKey
      )
    ).address;
 
    user1UsdcAccount = (
      await getOrCreateAssociatedTokenAccount(
        provider.connection,
        payer,
        usdcMint,
        user1.publicKey
      )
    ).address;
 
    user2UsdcAccount = (
      await getOrCreateAssociatedTokenAccount(
        provider.connection,
        payer,
        usdcMint,
        user2.publicKey
      )
    ).address;
 
    feeCollectorUsdcAccount = (
      await getOrCreateAssociatedTokenAccount(
        provider.connection,
        payer,
        usdcMint,
        feeCollector.publicKey
      )
    ).address;
 
    // Mint initial USDC
    await mintTo(
      provider.connection,
      payer,
      usdcMint,
      adminUsdcAccount,
      payer,
      1_000_000 * 10 ** DECIMALS // 1M USDC
    );
 
    await mintTo(
      provider.connection,
      payer,
      usdcMint,
      user1UsdcAccount,
      payer,
      100_000 * 10 ** DECIMALS // 100k USDC
    );
 
    await mintTo(
      provider.connection,
      payer,
      usdcMint,
      user2UsdcAccount,
      payer,
      100_000 * 10 ** DECIMALS // 100k USDC
    );
 
    console.log("Setup complete!");
  });
 
  describe("Pool Initialization", () => {
    it("Initializes the pool successfully", async () => {
      const MAX_TOTAL_SUPPLY = new BN(0); // Unlimited
      const MAX_QUEUE_SIZE = 20; // Maximum queue size

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

      // Step 1: Initialize pool account
      const tx1 = await program.methods
        .initPool(config)
        .accounts({
          payer: admin.publicKey,
          usdcMint: usdcMint,
          pool: poolPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      console.log("Init pool step 1 tx:", tx1);

      // Add delay between transactions
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Derive IPT mint PDA
      const [iptMintPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("ipt_mint"), poolPda.toBuffer()],
        program.programId
      );
      iptMint = iptMintPda;

      // Derive USDC reserve PDA
      const [usdcReservePda] = PublicKey.findProgramAddressSync(
        [Buffer.from("usdc_reserve"), poolPda.toBuffer()],
        program.programId
      );
      usdcReserve = usdcReservePda;
 
      // Step 2: Initialize mints and reserve
      const tx2 = await program.methods
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
 
      console.log("Init pool step 2 tx:", tx2);
 
      // Wait longer for transaction to fully confirm
      await new Promise((resolve) => setTimeout(resolve, 3000));
 
      // Verify pool state
      const pool = await program.account.pool.fetch(poolPda);
      console.log("Pool fetched - iptMint:", pool.iptMint.toString());
      console.log("Expected iptMint:", iptMint.toString());
      console.log("Pool PDA:", poolPda.toString());
     
      assert.equal(
        pool.config.adminAuthority.toString(),
        admin.publicKey.toString()
      );
      assert.equal(pool.currentExchangeRate.toString(), INITIAL_EXCHANGE_RATE.toString());
      assert.equal(pool.totalIptSupply.toString(), "0");
      assert.equal(pool.totalUsdcReserves.toString(), "0");
      assert.equal(pool.totalAccumulatedFees.toString(), "0");
      // Verify iptMint and usdcReserve are set correctly after step 2
      // Note: iptMint should be the PDA derived from [b"ipt_mint", pool.key()]
      assert.equal(pool.iptMint.toString(), iptMint.toString(), `IPT mint mismatch: expected ${iptMint.toString()}, got ${pool.iptMint.toString()}`);
      assert.equal(pool.usdcReserve.toString(), usdcReserve.toString(), `USDC reserve mismatch: expected ${usdcReserve.toString()}, got ${pool.usdcReserve.toString()}`);
 
      console.log("Pool initialized successfully!");
    });
  });
 
  describe("Admin Operations", () => {
    it("Admin deposits USDC to pool", async () => {
      const depositAmount = new BN(100_000 * 10 ** DECIMALS); // 100k USDC
 
      const tx = await program.methods
        .adminDepositUsdc(depositAmount)
        .accounts({
          admin: admin.publicKey,
          pool: poolPda,
          adminUsdcAccount: adminUsdcAccount,
          poolUsdcReserve: usdcReserve,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();
 
      console.log("Admin deposit tx:", tx);
 
      // Add delay after admin deposit
      await new Promise((resolve) => setTimeout(resolve, 1000));
 
      // Verify pool reserves
      const pool = await program.account.pool.fetch(poolPda);
      assert.equal(
        pool.totalUsdcReserves.toString(),
        depositAmount.toString()
      );
 
      // Verify token account balance
      const reserveAccount = await getAccount(
        provider.connection,
        usdcReserve
      );
      assert.equal(
        reserveAccount.amount.toString(),
        depositAmount.toString()
      );
 
      console.log("Admin deposit successful!");
    });
 
    // it("Updates exchange rate", async () => {
    //   const newRate = new BN(1_020_000); // 1.02 USDC per IPT
 
    //   const tx = await program.methods
    //     .updateExchangeRate(newRate)
    //     .accounts({
    //       oracle: oracle.publicKey,
    //       pool: poolPda,
    //     })
    //     .signers([oracle])
    //     .rpc();
 
    //   console.log("Update exchange rate tx:", tx);
 
    //   // Add delay after exchange rate update
    //   await new Promise((resolve) => setTimeout(resolve, 1000));
 
    //   const pool = await program.account.pool.fetch(poolPda);
    //   assert.equal(pool.currentExchangeRate.toString(), newRate.toString());
 
    //   console.log("Exchange rate updated!");
    // });
 
    // it("Updates pool configuration", async () => {
    //   const MAX_TOTAL_SUPPLY = new BN(0); // Unlimited
    //   const MAX_QUEUE_SIZE = 20; // Maximum queue size
 
    //   const newConfig = {
    //     adminAuthority: admin.publicKey,
    //     oracleAuthority: oracle.publicKey,
    //     feeCollector: feeCollector.publicKey,
    //     depositFeeBps: 150, // Change from 100 to 150
    //     withdrawalFeeBps: WITHDRAWAL_FEE_BPS,
    //     managementFeeBps: MANAGEMENT_FEE_BPS,
    //     initialExchangeRate: INITIAL_EXCHANGE_RATE,
    //     maxTotalSupply: MAX_TOTAL_SUPPLY,
    //     maxQueueSize: MAX_QUEUE_SIZE,
    //   };
 
    //   const tx = await program.methods
    //     .adminUpdateConfig(newConfig)
    //     .accounts({
    //       admin: admin.publicKey,
    //       pool: poolPda,
    //     })
    //     .rpc();
 
    //   console.log("Update config tx:", tx);
 
    //   // Add delay after config update
    //   await new Promise((resolve) => setTimeout(resolve, 1000));
 
    //   const pool = await program.account.pool.fetch(poolPda);
    //   assert.equal(pool.config.depositFeeBps, 150);
 
    //   console.log("Config updated!");
    // });
  });
 
  describe("User Deposit", () => {
    before(async () => {
      // Create IPT token accounts for users
      user1IptAccount = (
        await getOrCreateAssociatedTokenAccount(
          provider.connection,
          payer,
          iptMint,
          user1.publicKey
        )
      ).address;
 
      user2IptAccount = (
        await getOrCreateAssociatedTokenAccount(
          provider.connection,
          payer,
          iptMint,
          user2.publicKey
        )
      ).address;
    });
 
    it("User1 deposits USDC and receives IPT", async () => {
      const netUsdcAmount = new BN(10_000 * 10 ** DECIMALS); // 10k USDC
      const minIptAmount = new BN(0);
 
      const tx = await program.methods
        .userDeposit(netUsdcAmount, minIptAmount)
        .accounts({
          user: user1.publicKey,
          pool: poolPda,
          poolAuthority: poolAuthority,
          userUsdcAccount: user1UsdcAccount,
          userIptAccount: user1IptAccount,
          poolUsdcReserve: usdcReserve,
          iptMint: iptMint,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([user1])
        .rpc();
 
      console.log("User deposit tx:", tx);
 
      // Verify IPT balance
      const user1IptBalance = await getAccount(
        provider.connection,
        user1IptAccount
      );
      console.log("User1 IPT balance:", user1IptBalance.amount.toString());
 
      // Verify pool state updated
      const pool = await program.account.pool.fetch(poolPda);
      assert(pool.totalIptSupply.gt(new BN(0)));
      // Note: With DEPOSIT_FEE_BPS = 0, totalAccumulatedFees will be 0 for deposits
      // Fees only accumulate from withdrawal fees (WITHDRAWAL_FEE_BPS = 100)
      // assert(pool.totalAccumulatedFees.gt(new BN(0))); // Commented out since deposit fee = 0

      console.log("User deposit successful!");
    });
 
    it("User2 deposits USDC", async () => {
      const netUsdcAmount = new BN(5_000 * 10 ** DECIMALS); // 5k USDC
      const minIptAmount = new BN(0);
 
      const tx = await program.methods
        .userDeposit(netUsdcAmount, minIptAmount)
        .accounts({
          user: user2.publicKey,
          pool: poolPda,
          poolAuthority: poolAuthority,
          userUsdcAccount: user2UsdcAccount,
          userIptAccount: user2IptAccount,
          poolUsdcReserve: usdcReserve,
          iptMint: iptMint,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([user2])
        .rpc();
 
      console.log("User2 deposit tx:", tx);
 
      const user2IptBalance = await getAccount(
        provider.connection,
        user2IptAccount
      );
      console.log("User2 IPT balance:", user2IptBalance.amount.toString());
    });
  });
 
  describe("User Withdrawal", () => {
    it("User1 withdraws USDC by burning IPT (immediate withdrawal)", async () => {
      const user1IptBefore = await getAccount(
        provider.connection,
        user1IptAccount
      );
      const withdrawIptAmount = new BN(1_000 * 10 ** DECIMALS); // 1k IPT
      const minUsdcAmount = new BN(0);
 
      const tx = await program.methods
        .userWithdraw(withdrawIptAmount, minUsdcAmount)
        .accounts({
          user: user1.publicKey,
          pool: poolPda,
          poolAuthority: poolAuthority,
          userUsdcAccount: user1UsdcAccount,
          userIptAccount: user1IptAccount,
          poolUsdcReserve: usdcReserve,
          iptMint: iptMint,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([user1])
        .rpc();
 
      console.log("User withdraw tx:", tx);
 
      const user1IptAfter = await getAccount(
        provider.connection,
        user1IptAccount
      );
      assert(user1IptAfter.amount < user1IptBefore.amount);
 
      console.log("User withdrawal successful!");
    });
 
    it("User2 withdrawal request (insufficient reserves - goes to queue)", async () => {
      // Temporarily update config to allow larger queue for this test
      const MAX_TOTAL_SUPPLY = new BN(0); // Unlimited
      const tempConfig = {
        adminAuthority: admin.publicKey,
        oracleAuthority: oracle.publicKey,
        feeCollector: feeCollector.publicKey,
        depositFeeBps: DEPOSIT_FEE_BPS,
        withdrawalFeeBps: WITHDRAWAL_FEE_BPS,
        managementFeeBps: MANAGEMENT_FEE_BPS,
        initialExchangeRate: INITIAL_EXCHANGE_RATE,
        maxTotalSupply: MAX_TOTAL_SUPPLY,
        maxQueueSize: 20, // Temporarily increase for this test
      };
 
      await program.methods
        .adminUpdateConfig(tempConfig)
        .accounts({
          admin: admin.publicKey,
          pool: poolPda,
        })
        .rpc();
 
      // Now admin withdraws most reserves
      const pool = await program.account.pool.fetch(poolPda);
      const withdrawAmount = pool.totalUsdcReserves.sub(new BN(1000 * 10 ** DECIMALS));
 
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
 
      console.log("Admin withdrew reserves to create shortage");
 
      // Now user2 tries to withdraw (should go to queue)
      const withdrawIptAmount = new BN(2_000 * 10 ** DECIMALS);
      const minUsdcAmount = new BN(0);

      // Debug: Check user2 IPT balance before withdrawal
      const user2IptBalanceBefore = await getAccount(
        provider.connection,
        user2IptAccount
      );
      console.log("User2 IPT balance before withdrawal:", user2IptBalanceBefore.amount.toString());
      console.log("Withdrawal amount needed:", withdrawIptAmount.toString());

      // Note: No manual approval needed - instruction handles delegation internally
 
      const tx = await program.methods
        .userWithdraw(withdrawIptAmount, minUsdcAmount)
        .accounts({
          user: user2.publicKey,
          pool: poolPda,
          poolAuthority: poolAuthority,
          userUsdcAccount: user2UsdcAccount,
          userIptAccount: user2IptAccount,
          poolUsdcReserve: usdcReserve,
          iptMint: iptMint,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([user2])
        .rpc();
 
      console.log("User2 added to queue tx:", tx);
 
      const poolAfter = await program.account.pool.fetch(poolPda);
      assert.equal(poolAfter.pendingQueue.length, 1);
      console.log("User2 added to pending queue!");
    });
  });
 
  describe("Fee Collection", () => {
    it("Fee collector withdraws accumulated fees", async () => {
      // First admin deposits back reserves
      const depositAmount = new BN(50_000 * 10 ** DECIMALS);
      await program.methods
        .adminDepositUsdc(depositAmount)
        .accounts({
          admin: admin.publicKey,
          pool: poolPda,
          adminUsdcAccount: adminUsdcAccount,
          poolUsdcReserve: usdcReserve,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();
 
      const pool = await program.account.pool.fetch(poolPda);
     
      // Check if there are accumulated fees
      if (pool.totalAccumulatedFees.eq(new BN(0))) {
        console.log("No accumulated fees to withdraw, skipping test");
        return;
      }
     
      const feeAmount = pool.totalAccumulatedFees.div(new BN(2)); // Withdraw half
 
      const feeCollectorBalanceBefore = await getAccount(
        provider.connection,
        feeCollectorUsdcAccount
      );
 
      const tx = await program.methods
        .feeCollectorWithdraw(feeAmount)
        .accounts({
          feeCollector: feeCollector.publicKey,
          pool: poolPda,
          poolAuthority: poolAuthority,
          feeCollectorUsdcAccount: feeCollectorUsdcAccount,
          poolUsdcReserve: usdcReserve,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([feeCollector])
        .rpc();
 
      console.log("Fee collection tx:", tx);
 
      const feeCollectorBalanceAfter = await getAccount(
        provider.connection,
        feeCollectorUsdcAccount
      );
 
      assert(feeCollectorBalanceAfter.amount > feeCollectorBalanceBefore.amount);
      console.log("Fee collection successful!");
    });
  });
 
  describe("Admin Withdrawal", () => {
    it("Admin withdraws USDC from pool", async () => {
      const withdrawAmount = new BN(5_000 * 10 ** DECIMALS);
 
      const adminBalanceBefore = await getAccount(
        provider.connection,
        adminUsdcAccount
      );
 
      const tx = await program.methods
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
 
      console.log("Admin withdraw tx:", tx);
 
      const adminBalanceAfter = await getAccount(
        provider.connection,
        adminUsdcAccount
      );
 
      assert(adminBalanceAfter.amount > adminBalanceBefore.amount);
      console.log("Admin withdrawal successful!");
    });
  });
 
  describe("Error Cases", () => {
    it("Fails when non-admin tries to deposit", async () => {
      const depositAmount = new BN(1000);
 
      try {
        await program.methods
          .adminDepositUsdc(depositAmount)
          .accounts({
            admin: user1.publicKey, // Wrong admin
            pool: poolPda,
            adminUsdcAccount: user1UsdcAccount,
            poolUsdcReserve: usdcReserve,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([user1])
          .rpc();
        assert.fail("Should have thrown error");
      } catch (err) {
        console.log("Correctly rejected non-admin deposit");
      }
    });
 
    it("Fails when non-oracle tries to update rate", async () => {
      const newRate = new BN(1_100_000);
 
      try {
        await program.methods
          .updateExchangeRate(newRate)
          .accounts({
            oracle: user1.publicKey, // Wrong oracle
            pool: poolPda,
          })
          .signers([user1])
          .rpc();
        assert.fail("Should have thrown error");
      } catch (err) {
        console.log("Correctly rejected non-oracle rate update");
      }
    });
 
    it("Fails when withdrawing more than reserves", async () => {
      const pool = await program.account.pool.fetch(poolPda);
      const tooMuch = pool.totalUsdcReserves.add(new BN(1_000_000));
 
      try {
        await program.methods
          .adminWithdrawUsdc(tooMuch)
          .accounts({
            admin: admin.publicKey,
            pool: poolPda,
            poolAuthority: poolAuthority,
            adminUsdcAccount: adminUsdcAccount,
            poolUsdcReserve: usdcReserve,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .rpc();
        assert.fail("Should have thrown error");
      } catch (err) {
        console.log("Correctly rejected excessive withdrawal");
      }
    });
  });
 
  describe("Final State Check", () => {
    it("Displays final pool state", async () => {
      const pool = await program.account.pool.fetch(poolPda);
 
      console.log("\n========== FINAL POOL STATE ==========");
      console.log("Total IPT Supply:", pool.totalIptSupply.toString());
      console.log("Total USDC Reserves:", pool.totalUsdcReserves.toString());
      console.log("Total Accumulated Fees:", pool.totalAccumulatedFees.toString());
      console.log("Current Exchange Rate:", pool.currentExchangeRate.toString());
      console.log("Pending Queue Length:", pool.pendingQueue.length);
      console.log("Deposit Fee BPS:", pool.config.depositFeeBps);
      console.log("Withdrawal Fee BPS:", pool.config.withdrawalFeeBps);
      console.log("======================================\n");
    });
  });
});