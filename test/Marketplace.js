import assert from 'assert'
import helper from './_helper'
import marketplaceHelpers, { IpfsHash } from './_marketplaceHelpers'

// Account 0: Token owner. Marketplace owner
// Account 1: Seller
// Account 2: Buyer
// Account 3: Dispute resolver

describe('Marketplace.sol', async function() {
  var accounts, deploy, web3
  var Marketplace,
    OriginToken,
    DaiStableCoin,
    Buyer,
    // BuyerIdentity,
    Seller,
    SellerIdentity,
    Arbitrator,
    MarketArbitrator,
    ArbitratorAddr,
    helpers

  before(async function() {
    ({ deploy, accounts, web3 } = await helper(`${__dirname}/..`))

    Seller = accounts[1]
    Buyer = accounts[2]
    ArbitratorAddr = accounts[3]

    OriginToken = await deploy('Token', {
      from: accounts[0],
      path: 'contracts/',
      args: ['OriginToken', 'OG', 2, 12000]
    })

    DaiStableCoin = await deploy('Token', {
      from: accounts[0],
      path: 'contracts/',
      args: ['Dai', 'DAI', 2, 12000]
    })

    Arbitrator = await deploy('CentralizedArbitrator', {
      from: ArbitratorAddr,
      path: 'contracts/arbitration/',
      args: [0]
    })

    MarketArbitrator = await deploy('OriginArbitrator', {
      from: ArbitratorAddr,
      path: 'contracts/',
      args: [Arbitrator._address]
    })

    Marketplace = await deploy('Marketplace', {
      from: accounts[0],
      path: 'contracts/',
      args: [OriginToken._address]
    })

    SellerIdentity = await deploy('ClaimHolder', {
      from: Seller,
      path: `${__dirname}/../contracts/identity`
    })

    // BuyerIdentity = await deploy('ClaimHolder', {
    //   from: Buyer,
    //   path: `${__dirname}/../contracts/identity`
    // })

    helpers = marketplaceHelpers({
      Marketplace,
      web3,
      Buyer,
      Seller,
      OriginToken,
      MarketArbitrator
    })
  })

  it('should allow some tokens to be transferred to seller', async function() {
    var result = await OriginToken.methods.transfer(Seller, 400).send()
    await OriginToken.methods.transfer(SellerIdentity._address, 400).send()
    assert(result.events.Transfer)
  })

  it('should allow DAI to be transferred to buyer', async function() {
    var result = await DaiStableCoin.methods.transfer(Buyer, 400).send()
    assert(result.events.Transfer)
  })

  describe('A listing in ETH', function() {
    it('should allow a new listing to be added', async function() {
      var result = await helpers.createListing({ Token: OriginToken })
      assert(result)

      var balance = await OriginToken.methods
        .balanceOf(Marketplace._address)
        .call()
      assert.equal(balance, 50)

      var total = await Marketplace.methods.totalListings().call()
      assert.equal(total, 1)

      var listing = await Marketplace.methods.listings(0).call()
      assert.equal(listing.seller, Seller)
    })

    it('should allow an offer to be made', async function() {
      var result = await helpers.makeOffer({})

      assert(result.events.OfferCreated)

      var offer = await Marketplace.methods.offers(0, 0).call()
      assert.equal(offer.buyer, Buyer)
    })

    it('should allow an offer to be accepted', async function() {
      var result = await Marketplace.methods
        .acceptOffer(0, 0, IpfsHash)
        .send({ from: Seller })
      assert(result.events.OfferAccepted)
    })

    it('should allow an offer to be finalized by buyer', async function() {
      var balanceBefore = await web3.eth.getBalance(Seller)

      var result = await Marketplace.methods.finalize(0, 0, IpfsHash).send({
        from: Buyer
      })
      assert(result.events.OfferFinalized)

      var balanceAfter = await web3.eth.getBalance(Seller)
      assert.equal(
        Number(balanceAfter),
        Number(balanceBefore) + Number(web3.utils.toWei('0.1', 'ether'))
      )
    })

    describe('withdrawing an offer', function() {
      it('should allow another offer to be made', async function() {
        var result = await helpers.makeOffer({})
        assert(result.events.OfferCreated)

        var offer = await Marketplace.methods.offers(0, 1).call()
        assert.equal(offer.buyer, Buyer)
      })
      it('should allow an offer to be withdrawn', async function() {
        var balanceBefore = await web3.eth.getBalance(Buyer)
        var result = await Marketplace.methods
          .withdrawOffer(0, 1, IpfsHash)
          .send({ from: Buyer })

        assert(result.events.OfferWithdrawn)

        var balanceAfter = await web3.eth.getBalance(Buyer)

        assert(Number(balanceAfter) > Number(balanceBefore))
      })
    })

    describe('updating an offer', function() {
      it('should allow an offer to be updated', async function() {
        var result = await helpers.makeOffer({})
        assert(result.events.OfferCreated)

        var result2 = await helpers.makeOffer({ withdraw: 2 })
        assert(result2.events.OfferWithdrawn)
        assert(result2.events.OfferCreated)
      })
    })

    describe('withdrawing a listing', function() {
      it('should allow a listing to be withdrawn', async function() {
        var listing = await helpers.createListing({ Token: OriginToken })
        var listingID = listing.events.ListingCreated.returnValues.listingID
        var result = await Marketplace.methods.withdrawListing(listingID, IpfsHash).send({
          from: Seller
        })
        assert(result.events.ListingWithdrawn)
      })
    })
  })

  describe('A listing in DAI', function() {
    let listingID

    describe('default flow', function() {
      it('should allow a new listing to be added', async function() {
        await OriginToken.methods
          .approve(Marketplace._address, 50)
          .send({ from: Seller })

        var result = await Marketplace.methods
          .createListing(IpfsHash, 50, '0x0')
          .send({ from: Seller })

        listingID = result.events.ListingCreated.returnValues.listingID

        assert(result)
      })

      it('should allow an offer to be made', async function() {
        var result = await helpers.makeERC20Offer({
          Buyer,
          Token: DaiStableCoin,
          listingID
        })
        assert(result)

        var offer = await Marketplace.methods.offers(listingID, 0).call()
        assert.equal(offer.buyer, Buyer)
      })

      it('should allow an offer to be accepted', async function() {
        var result = await Marketplace.methods
          .acceptOffer(listingID, 0, IpfsHash)
          .send({ from: Seller })
        assert(result.events.OfferAccepted)
      })

      it('should allow an offer to be finalized', async function() {
        var balanceBefore = await DaiStableCoin.methods.balanceOf(Seller).call()

        var result = await Marketplace.methods
          .finalize(listingID, 0, IpfsHash)
          .send({
            from: Buyer
          })
        assert(result.events.OfferFinalized)

        var balanceAfter = await DaiStableCoin.methods.balanceOf(Seller).call()
        assert.equal(Number(balanceAfter), Number(balanceBefore) + 10)
      })
    })

    describe('withdrawing an offer', function() {
      it('should allow another offer to be made', async function() {
        var result = await helpers.makeERC20Offer({
          listingID,
          Buyer,
          Token: DaiStableCoin
        })
        assert(result)

        var offer = await Marketplace.methods.offers(listingID, 1).call()
        assert.equal(offer.buyer, Buyer)
      })

      it('should allow an offer to be withdrawn', async function() {
        var balanceBefore = await DaiStableCoin.methods.balanceOf(Buyer).call()

        var result = await Marketplace.methods
          .withdrawOffer(listingID, 1, IpfsHash)
          .send({
            from: Buyer
          })
        assert(result.events.OfferWithdrawn)

        var balanceAfter = await DaiStableCoin.methods.balanceOf(Buyer).call()
        assert.equal(Number(balanceAfter), Number(balanceBefore) + 10)
      })
    })

    describe('updating an offer', function() {
      it('should allow another offer to be made', async function() {
        var result = await helpers.makeERC20Offer({
          listingID,
          Buyer,
          Token: DaiStableCoin
        })
        assert(result)

        var result2 = await helpers.makeERC20Offer({
          listingID,
          Buyer,
          Token: DaiStableCoin,
          withdraw: 2
        })
        assert(result2)
      })
    })
  })

  describe('Arbitration', function() {
    let listingID, offerID

    it('should allow a dispute to be made', async function() {
      var result = await MarketArbitrator.methods
        .createDispute(10, 10)
        .send({ from: Seller })
      assert(result.events.Dispute)
    })

    it('should allow a new listing to be added', async function() {
      await OriginToken.methods
        .approve(Marketplace._address, 50)
        .send({ from: Seller })

      var result = await Marketplace.methods
        .createListing(IpfsHash, 50, '0x0')
        .send({ from: Seller })

      listingID = result.events.ListingCreated.returnValues.listingID

      assert(result)
    })

    it('should allow an offer to be made', async function() {
      var result = await helpers.makeOffer({ listingID })
      assert(result.events.OfferCreated)

      offerID = result.events.OfferCreated.returnValues.offerID
    })

    it('should allow an offer to be accepted', async function() {
      var result = await Marketplace.methods
        .acceptOffer(listingID, offerID, IpfsHash)
        .send({ from: Seller })
      assert(result.events.OfferAccepted)
    })

    it('should allow an offer to be disputed', async function() {
      var result = await Marketplace.methods
        .dispute(listingID, offerID, IpfsHash)
        .send({ from: Buyer })
      assert(result.events.OfferDisputed)
    })

    it('should allow a transaction to be resolved in favor of seller', async function() {
      var balanceBefore = await web3.eth.getBalance(Buyer)
      var result = await Arbitrator.methods
        .giveRuling(1, 0)
        .send({ from: ArbitratorAddr })

      assert(result)

      var balanceAfter = await web3.eth.getBalance(Buyer)
      assert(Number(balanceAfter) > Number(balanceBefore))

      // assert.equal(result.events.Dispute.returnValues.status, 1)
    })
  })

  describe('Updating', function() {
    let listingID

    it('should allow a new listing to be added', async function() {
      await OriginToken.methods
        .approve(Marketplace._address, 10)
        .send({ from: Seller })

      var result = await Marketplace.methods
        .createListing(IpfsHash, 10, '0x0')
        .send({ from: Seller })

      listingID = result.events.ListingCreated.returnValues.listingID

      assert(result)
    })

    it('should allow the listing to be updated', async function() {
      await OriginToken.methods
        .approve(Marketplace._address, 10)
        .send({ from: Seller })

      var result = await Marketplace.methods
        .updateListing(
          listingID,
          '0x98765432109876543210987654321098',
          10
        )
        .send({ from: Seller })

      assert(result)
    })
  })

  describe('A listing in ETH from an identity', function() {
    let listingID
    it('should allow a new listing to be added', async function() {
      var result = await helpers.createListing({ Identity: SellerIdentity })
      assert(result)
      listingID = web3.utils.hexToNumber(result.events['1'].raw.topics[2])

      var listing = await Marketplace.methods.listings(listingID).call()
      assert.equal(listing.seller, SellerIdentity._address)
    })

    // it('should allow the listing to be updated', async function() {
    //   await OriginToken.methods
    //     .transfer(SellerIdentity._address, 10)
    //     .send({ from: Seller })
    //
    //   var approveAbi = await OriginToken.methods
    //     .approve(Marketplace._address, 10)
    //     .encodeABI()
    //
    //   await SellerIdentity.methods
    //     .execute(OriginToken._address, 0, approveAbi)
    //     .send({ from: Seller })
    //
    //   var updateAbi = await Marketplace.methods
    //     .updateListing(
    //       listingID,
    //       '0x98765432109876543210987654321098',
    //       10,
    //       false
    //     )
    //     .encodeABI()
    //
    //   var result = await SellerIdentity.methods
    //     .execute(Marketplace._address, 0, updateAbi)
    //     .send({ from: Seller })
    //
    //   console.log(result)
    //
    //   assert(result)
    // })

    // it('should allow an offer to be made', async function() {
    //   var result = await helpers.makeOffer({})
    //
    //   assert(result.events.OfferCreated)
    //
    //   var offer = await Marketplace.methods.offers(0, 0).call()
    //   assert.equal(offer.buyer, Buyer)
    // })
    //
    // it('should allow an offer to be accepted', async function() {
    //   var result = await Marketplace.methods
    //     .acceptOffer(0, 0, IpfsHash)
    //     .send({ from: Seller })
    //   assert(result.events.OfferAccepted)
    // })
    //
    // it('should allow an offer to be finalized by buyer', async function() {
    //   var balanceBefore = await web3.eth.getBalance(Seller)
    //
    //   var result = await Marketplace.methods.finalize(0, 0, IpfsHash).send({
    //     from: Buyer
    //   })
    //   assert(result.events.OfferFinalized)
    //
    //   var balanceAfter = await web3.eth.getBalance(Seller)
    //   assert.equal(
    //     Number(balanceAfter),
    //     Number(balanceBefore) + Number(web3.utils.toWei('0.1', 'ether'))
    //   )
    // })
  })
})
