const program = require('commander');

program
  .option('-f <dockerfile>', 'Dockerfile to use')
  .parse(process.argv);
