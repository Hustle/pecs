class Cluster {
  constructor(arn) {
    this.arn = arn;
  }

  async services() {
    return ecs.listServices({ cluster: this.arn }).promise();
  }
}

module.exports = Cluster;
