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

    async.map(machineIdentities, function (machineIdentity, next_machineSuite){

      eachTestSuite(machineIdentity, function (onTestFn, informSuiteFinished){

        // Load machine tests, supporting .json and .json5 files
        var pathToTestSuiteModule = path.resolve(testsPath, machineIdentity);
        var testSuite;
        try {
          testSuite = require(pathToTestSuiteModule + '.json');
        } catch (e) {
          if (e.toString().indexOf('SyntaxError') > -1) {
            throw e;
          }
          testSuite = require(pathToTestSuiteModule + '.json5');
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
              console.error('Internal error while running tests:',err);
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
        return done(err);
      }
      return done(null, results);
    });
  });
};
