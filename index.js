/**
 * Module dependencies
 */

var path = require('path');


// For programmatic use:
module.exports = {

  // To programmatically call the stub/default/base driver:
  runTestsWithStubDriver: function (pathToMachinepackDir){

    // Use cwd as our path unless overridden by the arg above
    pathToMachinepackDir = pathToMachinepackDir || process.cwd();

    // Call the stub driver
    require('./stub-driver')(pathToMachinepackDir);
  },

  // To access the raw underlying runner for use when writing drivers (e.g. for mocha)
  rawTestRunner: require('./run-all-tests')
};
