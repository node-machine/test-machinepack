/**
 * Module depenencies
 */

var util = require('util');
var _ = require('lodash');
var async = require('async');
var path = require('path');
//replace's nodejs' require to support requiring of .json5 files
require('json5/lib/require');


module.exports = function (mpPath, beforeRunningAnyTests, eachTestSuite, done){

  // Use provided machinepack path
  var mainPath = path.resolve(mpPath);
  // var mainPath = path.resolve(mpPath, 'index.js');
  var packageJsonPath = path.resolve(mpPath, 'package.json');
  var testsPath = path.resolve(mpPath, 'tests');

  // Load pack
  var Pack = require(mainPath);

  // TODO: load opts from somewhere, normalize them, then pass them to `beforeRunningAnyTests` fn in driver.
  var opts = {};

  beforeRunningAnyTests(opts, function readyToGo(err){
    if (err) return done(err);

    var machineIdentities;
    try {
      machineIdentities = require(packageJsonPath).machinepack.machines;
    }
    catch (e) {
      return done(new Error(util.format('Encountered error loading or parsing pack\'s package.json file (located at `%s`). Details:\n',packageJsonPath, e)));
    }

    var missingSuites = [];
    async.map(machineIdentities, function (machineIdentity, next_machineSuite){

      eachTestSuite(machineIdentity, function (onTestFn, informSuiteFinished){

        // Load machine tests, supporting .json and .json5 files
        var pathToTestSuiteModule = path.resolve(testsPath, machineIdentity);
        var testSuite;
        try {
          testSuite = require(pathToTestSuiteModule + '.json');
        } catch (e_cannotFindJsonFile) {
          // TODO: (-> low priority)
          // instead of checking for syntax error, do the inverse,
          // checking that if this is a MODULE_NOT_FOUND error. if it's not
          // MODULE_NOT_FOUND error, we should bail out by calling next_machineSuite
          // with an error (and I think that should work gracefully)
          if (e_cannotFindJsonFile.toString().indexOf('SyntaxError') > -1) {
            throw e_cannotFindJsonFile;
          }
          try {
            testSuite = require(pathToTestSuiteModule + '.json5');
          }
          catch (err_cannotFindJson5File) {
            // if this is a MODULE_NOT_FOUND error, then the file doesn't exist.
            // so we can skip this particular test
            if (err_cannotFindJson5File.code === 'MODULE_NOT_FOUND') {
              missingSuites.push(machineIdentity);
              // TODO: consider adding a special case that drivers can use
              // to optionally provide special handling for skipped tests

              // Call informational callback, if provided
              if (_.isFunction(informSuiteFinished)) {
                informSuiteFinished();
              }
              return next_machineSuite();
            }
          }
        }

        // And run them
        require('./run-test-suite')(
          Pack,
          testSuite,
          function eachTestCase (testCase, runTest){
            onTestFn(testCase, runTest);
          },
          function afterwards (err, finalTestResults) {
            if (err) {
              // TODO: better error msg which includes info about the test suite
              console.error('Internal error while running tests:',err);
              next_machineSuite();
              return;
            }

            // Call informational callback, if provided
            if (_.isFunction(informSuiteFinished)) {
              informSuiteFinished();
            }

            next_machineSuite();
          }
        );

      });
    }, function (err, results) {
      if (err) {
        return done(err, missingSuites);
      }
      return done(null, missingSuites);
    });
  });
};
