/**
 * Module depenencies
 */

var util = require('util');
var _ = require('lodash');
var async = require('async');
var path = require('path');

// Load pack in cwd
// (TODO be more flexible)
var mpPath = process.cwd();
var mainPath = path.resolve(mpPath, 'index.js');
var packageJsonPath = path.resolve(mpPath, 'package.json');
var testsPath = path.resolve(mpPath, 'tests');

module.exports = function (beforeRunningAnyTests, eachTestSuite, done){

  // Load pack
  var Pack = require(mainPath);

  // TODO: load opts and pass them to `beforeRunningAnyTests` fn
  var opts = {};

  beforeRunningAnyTests(opts, function readyToGo(err){
    if (err) return done(err);

    var machineIdentities;
    try {
      machineIdentities = require(packageJsonPath).machinepack.machines;
    }
    catch (e) {
      return done(e);
    }

    async.map(machineIdentities, function (machineIdentity, next_machineSuite){

      eachTestSuite(machineIdentity, function (onTestFn, informSuiteFinished){

        // Load machine tests
        var pathToTestSuiteModule = path.resolve(testsPath, machineIdentity + '.json');
        var testSuite = require(pathToTestSuiteModule);

        // And run them
        require('./run-test-suite')(
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
