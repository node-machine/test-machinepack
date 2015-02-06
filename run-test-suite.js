/**
 * Module depenencies
 */

var util = require('util');
var _ = require('lodash');
var async = require('async');



module.exports = function (Pack, testSuite, eachTest, done){

  var machine = _.find(Pack, {identity: testSuite.machine});
  if (!machine) {
    throw new Error(util.format('Unrecognized machine: `%s`', testSuite.machine));
  }

  async.map(testSuite.expectations, function (testCase, next_testCase){

    // Defer test
    if (testCase.todo){
      eachTest(testCase, function (informTestFinished){
        if (_.isFunction(informTestFinished)){
          informTestFinished();
        }
        return next_testCase();
      });
      return;
    }

    eachTest(testCase, function (informTestFinished){

      // Configure the inputs
      var machineInstance = machine(testCase.using||{});

      // Build an empty `exitsTraversed` array that will track which exit was traversed,
      // and its return value (if applicable).
      var exitsTraversed = [ /* e.g. {
        returnValue: {some: 'stuff'}
        exitName: 'whateverExit'
      } */ ];

      // Loop through each of the machine's declared exits and set up
      // a handler for it so we know which exit was traversed.
      var callbacks = {};
      _.each(machineInstance.exits, function (exitDef, exitName){
        callbacks[exitName] = function (result){
          exitsTraversed.push({
            returnValue: result,
            exitName: exitName
          });

          if (exitsTraversed.length > 1) {
            // This should never happen (log a warning)
            console.warn('Invalid machine; exited multiple times:', exitsTraversed);
          }
        };
      });

      // Now start executing the machine
      machineInstance.exec(callbacks);

      // And set up a `whilst` loop that checks to see if the machine has
      // halted every 50ms.
      //
      // (we can safely do this AFTER calling .exec() on the machine since we know there
      //  will always be at least a setTimeout(0) before the `fn` runs.)
      async.whilst(
        function check() {
          return exitsTraversed.length < 1;
        },
        function lap(next){
          setTimeout(function (){
            next();
          }, 50);
        },
        function afterwards(err) {
          if (err) return next_testCase(err);

          // Build test result object
          var testResultObj = {
            pass: (function _determineIfTestCasePassed(){
              var _passed = true;

              if (_.isString(testCase.outcome)) {
                _passed = _passed && (testCase.outcome === exitsTraversed[0].exitName);
              }

              // TODO: support other assertions

              return _passed;
            })(),
          };

          // Report back to test engine
          if (testResultObj.pass) {
            informTestFinished();
          }
          else {
            var _testFailedErr = new Error();
            _testFailedErr.message = util.format('Failed test #%s for machine `%s`.', '?',testSuite.machine);
            _.extend(_testFailedErr, testCase);
            _.extend(_testFailedErr, {
              actual: {
                // TODO: support other assertions
                outcome: exitsTraversed[0].exitName
              }
            });

            // enhance result msg
            if (_.isString(testCase.outcome)) {
              _testFailedErr.message += util.format('Expected outcome "%s" but actually the machine triggered its "%s" exit.', testCase.outcome, _testFailedErr.actual.outcome);
            }

            informTestFinished(_testFailedErr);
          }

          // Continue to next test
          return next_testCase(null, testResultObj);
        }
      );

    });
  }, function (err, results) {
    if (err) {
      if (_.isFunction(done)) {
        return done(err);
      }
    }
    if (_.isFunction(done)) {
      return done(null, results);
    }
  });
};
