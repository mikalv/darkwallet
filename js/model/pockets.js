'use strict';

define(['bitcoinjs-lib', 'model/pocket/hd', 'model/pocket/multisig', 'model/pocket/readonly'], function(Bitcoin, HdPocket, MultisigPocket, ReadOnlyPocket) {

/**
 * Pocket functionality.
 * @param {Object} store Store for the object.
 * @param {Object} identity Identity for the object.
 * @param {Object} wallet Wallet for the object.
 * @constructor
 */
function Pockets(store, identity, wallet) {
    this.store = store;
    this.wallet = wallet;
    this.registerTypes();
    this.initPockets(store);
}

/**
 * Register all pocket types
 * @private
 */

Pockets.prototype.registerTypes = function() {
    this.pocketTypes = {};
    this.addressTypes = {};
    this.pocketFactories= {};
    this.registerType(HdPocket);
    this.registerType(MultisigPocket);
    this.registerType(ReadOnlyPocket);
}

/**
 * Register a pocket type
 * @private
 */
Pockets.prototype.registerType = function(pocketType) {
    var self = this;
    var name = pocketType.prototype.type;
    this.pocketTypes[name] = pocketType.prototype;
    this.pocketFactories[name] = pocketType;
    pocketType.prototype.types.forEach(function(type) {
        self.addressTypes[type] = pocketType.prototype;
    });
}

/**
 * Initialize store and internal caches for pockets
 * @param {String} store Identity store
 * @return {Object[]} List of pockets
 * @private
 */
Pockets.prototype.initPockets = function(store) {
    this.hdPockets = store.init('pockets', [{name:'spending'}, {name: 'savings'}]);

    // Init pocket wallets (temporary cache for pockets)
    this.pockets = { 'hd': {}, 'multisig': {}, 'readonly': {} };
    for(var i=0; i< this.hdPockets.length; i++) {
        if (this.hdPockets[i]) {
            this.initPocketWallet('hd', i, this.hdPockets[i]);
        }
    }
    return this.hdPockets;
};

/**
 * Create pocket with the given name
 * @param {String} name Name for the new pocket
 */
Pockets.prototype.createPocket = function(name) {
    // Raise exception if name exists
    if (this.search('hd', {'name': name})) {
        throw new Error("Pocket with that name already exists!");
    }
    var pocketStore = {'name': name};
    this.hdPockets.push(pocketStore);
    this.initPocketWallet('hd', this.hdPockets.length-1, pocketStore);
    this.store.save();
};

/**
 * Initialize a pockets wallet
 * @param {Object} id Pocket id (can be branch number, multisig address...)
 * @private
 */
Pockets.prototype.initPocketWallet = function(type, id, pocketStore) {
    if (type === 'multisig') {
        var fund = this.wallet.multisig.search({ address: id });
        if (!fund) {
            // TODO: Create a fake fund for now
            fund = {address: id, name: id};
            console.log("No fund for this address!", id);
        }
        this.pockets.multisig[id] = new MultisigPocket(fund, this);
    } else if (this.pockets[type] && this.pocketFactories[type]) {
        pocketStore = pocketStore ? pocketStore : {id: id};
        var PocketFactory = this.pocketFactories[type];
        this.pockets[type][id] = new PocketFactory(pocketStore, this);
    } else {
        console.log("could not create pocket!", type);
    }
    return this.pockets[type][id];
};

/**
 * Search for a pocket
 * @param {String} type Pocket type
 * @param {Object} search Search query, has to be one key: value for now.
 */

Pockets.prototype.search = function(type, search) {
    var label = Object.keys(search)[0];
    var value = search[label];
    var keys = Object.keys(this.pockets[type]);
    for(var i=0; i<keys.length; i++) {
        if (this.pockets[type][keys[i]][label] === value) {
            return this.pockets[type][keys[i]];
        }
    }
}


/**
 * Get an hd pocket by name
 * @param {String} name Name for the pocket
 * @return {Object} The pocket with the given name
 */
Pockets.prototype.getPocket = function(pocketId, addressType) {
    var type = this.addressTypes[addressType].type;
    return this.pockets[type][pocketId];
};

/**
 * Delete a pocket
 * @param {String} name Name for the pocket to delete
 * @throws {Error} When the pocket doesn't exist
 */
Pockets.prototype.deletePocket = function(type, pocketId) {
   var oldPocket;
    if (this.pockets[type][pocketId]) {
        oldPocket = this.pockets[type][pocketId];
        delete this.pockets[type][pocketId];
        this.store.save();
    }
    // Backwards compatibility while cleaning up:
    if (type == 'hd' && oldPocket) {
        var name = oldPocket.store.name;
        for(var i=0; i<this.hdPockets.length; i++) {
            if (this.hdPockets[i] && (this.hdPockets[i].name == name)) {
                 var pocket = this.hdPockets[i];
                 this.hdPockets[i] = null;
                 this.store.save();
                 return;
             }
         }
         throw new Error("Pocket with that name does not exist!");
    }
};

/**
 * Get the pocket index for a wallet address
 * @param {Object} walletAddress Address we're looking for. See {@link Wallet#getWalletAddress}.
 * @return {Number|String} The pocket index
 */
Pockets.prototype.getAddressPocketId = function(walletAddress) {
    return this.addressTypes[walletAddress.type].getIndex(walletAddress);
};

/**
 * Get all pockets of a certain type
 */

Pockets.prototype.getPockets = function(type) {
    var pockets = this.pockets[this.addressTypes[type].type];
    if (!pockets) {
        throw new Error("Unknown address type! " + type);
    }
    return pockets;
}

/**
 * Add an address to its pocket
 * @param {Object} walletAddress Address we're adding. See {@link Wallet#getWalletAddress}.
 */
Pockets.prototype.addToPocket = function(walletAddress) {
    var pocketBase = this.getPockets(walletAddress.type);
    var pocketId = this.getAddressPocketId(walletAddress);
    // Only autoinitialize multisig funds for now
    var addressType = this.addressTypes[walletAddress.type];
    if (addressType && addressType.autoCreate && !(this.pockets[addressType.type][pocketId])) {
        this.initPocketWallet(addressType.type, pocketId);
    }
    pocketBase[pocketId].addToPocket(walletAddress);
};

/**
 * Gets all public addresses for this pocket.
 * @param {Object} id Pocket id (can be branch number, multisig address...)
 * @return {Array} An array of strings with the addresses.
 */
Pockets.prototype.getAddresses = function(id, type) {
    type = type ? type : 'hd';
    return this.pockets[type][id].getAddresses();
};

/**
 * Gets all change addresses for a pocket.
 * @param {Object} id Pocket id (can be branch number, multisig address...)
 * @return {Array} An array of strings with the addresses.
 */
Pockets.prototype.getChangeAddresses = function(id, type) {
    type = type ? type : 'hd';
    return this.pockets[type][id].getChangeAddresses();
};

/**
 * Gets all addresses for a pocket.
 * @param {Object} id Pocket id (can be pocket index, multisig address...)
 * @return {Array} An array of strings with the addresses.
 */
Pockets.prototype.getAllAddresses = function(id, type) {
    type = type ? type : 'hd';
    return this.pockets[type][id].getAllAddresses();
};

/**
 * Gets the pocket wallet for a pocket
 * @param {Object} id Pocket id (can be pocket index, multisig address...)
 * @return {Object} The pocket wallet
 */
Pockets.prototype.getPocketWallet = function(id, type) {
    // Default to multisig or hd for backwards compatibility.
    type = type ? type : (typeof id === 'string') ? 'multisig' : 'hd';
    return this.pockets[type][id].getWallet();
};

return Pockets;
});
