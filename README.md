PECS: Flex your ECS muscles
===========================

PECS allows you to easily deploy your docker projects to AWS's ECS platform.

Currently requires that AWS is configured via the environment:
  - `AWS_ACCESS_KEY_ID` must be set
  - `AWS_SECRET_ACCESS_KEY` must be set

Requires Node 8+

### Installation ###

```sh
npm install -g pecs
```

### Usage ###

```sh
pecs <command>

Commands:
  pecs release   Update service(s) with new image
  pecs rollback  Roll back service(s)
```

#### Release ####
```
pecs release

Update service(s) with new image

Common args:
  -c, --cluster   Cluster to modify                         [default: "default"]
  -s, --services  Services that should be modified         [array] [default: []]
  -t, --tag       Image tag that should be released          [default: "latest"]

Options:
  --help        Show help                                              [boolean]
  --version     Show version number                                    [boolean]
  -r, --region  Region for ECS cluster                    [default: "us-east-1"]

Examples:
  pecs release -c dev -s api            update dev api service
  pecs release -c dev -s api worker     update dev api + worker services
  pecs release -c dev -s api -t v1.2.3  update dev api to v1.2.3
```

#### Rollback ####

```
pecs rollback

Roll back service(s)

Common args:
  -c, --cluster   Cluster to modify                         [default: "default"]
  -s, --services  Services that should be modified         [array] [default: []]
  --rev           Desired relative revision to release  [number] [default: "-1"]

Options:
  --help        Show help                                              [boolean]
  --version     Show version number                                    [boolean]
  -r, --region  Region for ECS cluster                    [default: "us-east-1"]

Examples:
  pecs rollback -c dev -s api           roll back api to previous task def
  pecs rollback -c dev -s api worker    roll back api + worker
  pecs rollback -c dev -s api --rev -2  roll back api 2 release ago
```
