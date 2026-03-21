const isOwnedAddress = (targetAddr, registeredAddrList) => {
  if (!targetAddr || !Array.isArray(registeredAddrList)) {
    return false;
  }

  const deleteCandidate = registeredAddrList.filter((registeredAddrObj) => {
    return targetAddr.addr_id === registeredAddrObj.addr_id
      && targetAddr.ext_addr_id === registeredAddrObj.ext_addr_id;
  });

  return deleteCandidate.length > 0;
};

module.exports = {
  isOwnedAddress,
};
