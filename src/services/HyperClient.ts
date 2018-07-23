import { Injector } from 'reduct'
import * as Boom from 'boom'
import Config from './Config'
import { PodSpec } from '../schemas/PodSpec'
import axios from 'axios'
import { get, IncomingMessage } from 'http'
import * as querystring from 'querystring'

import { create as createLogger } from '../common/log'
const log = createLogger('HyperClient')

export interface HyperPodInfoResponse {
  podID: string
  kind: string
  apiVersion: string
  vm: string
  createdAt: number
  spec: {
    containers: {
      args: string[],
      containerID: string,
      env: {
        env: string,
        value: string
      }[],
      image: string,
      imageID: string,
      name: string,
      volumeMounts: {
        mountPath: string,
        name: string
      },
      workingDir: string
    }[],
    memory: number,
    vcpu: number,
    volumes: {
      driver: string,
      name: string,
      source: string
    }[]
  },
  status: {
    phase: string
    hostIP: string
    podIP: string[]
    containerStatus: {
      containerID: string,
      name: string,
      phase: string,
      running: {
        startedAt: string
      },
      terminated: object,
      waiting: object
    }[]
  }
  podName: string
}

export default class HyperClient {
  private config: Config

  constructor (deps: Injector) {
    this.config = deps(Config)
  }

  async getPodInfo (hash: string): Promise<HyperPodInfoResponse> {
    log.debug(`fetching pod info. id=${hash}`)
    const response = await axios.request({
      socketPath: this.config.hyperSock,
      method: 'get',
      url: '/pod/info',
      params: { podName: hash },
      responseType: 'json'
    })
    return response.data
  }

  async getPodIP (hash: string): Promise<string> {
    if (this.config.noop) return ''
    const info = await this.getPodInfo(hash)
    const [ cidr ] = info.status.podIP
    const [ ip ] = cidr.split('/')
    return ip
  }

  async pullImages (podSpec: PodSpec): Promise<void> {
    if (this.config.noop) return
    for (const container of podSpec.containers) {
      await this.pullImage(container.image)
    }
  }

  async pullImage (image: string): Promise<void> {
    if (this.config.noop) return
    log.info(`pulling image=${image}`)
    const start = Date.now()
    await axios.request({
      socketPath: this.config.hyperSock,
      method: 'post',
      url: '/image/create',
      params: { imageName: image }
    })
    const elapsed = Date.now() - start
    log.info(`pulled image=${image} in ${elapsed}ms`)
  }

  async createPod (podSpec: PodSpec): Promise<void> {
    if (this.config.noop) return
    log.info('creating pod. id=%s', podSpec.id)
    console.log('waiting 5s to run axios')
    await new Promise(resolve => {
      setTimeout(() => {
        console.log('waited 5s to run axios')
        resolve()
      }, 5000)
    })
    const res = await axios.request({
      socketPath: this.config.hyperSock,
      method: 'post',
      url: '/pod/create',
      data: podSpec
    })
    console.log('axios done')
    console.log('waiting 5s to return from hyperclient createpod')
    await new Promise(resolve => {
      setTimeout(() => {
        console.log('waited 5s to return from hyperclient createpod')
        resolve()
      }, 5000)
    })
    if (res.data.Code !== 0) {
      console.log('waiting 5s to throw hyperclient')
      await new Promise(resolve => {
        setTimeout(() => {
          console.log('waited 5s to throw hyperclient')
          resolve()
        }, 5000)
      })
      throw Boom.serverUnavailable('Could not create pod: hyper error code=' + res.data.Code)
    }
  }

  async startPod (podId: string): Promise<void> {
    if (this.config.noop) return
    log.info('starting pod. id=%s', podId)
    await axios.request({
      socketPath: this.config.hyperSock,
      method: 'post',
      url: '/pod/start',
      params: { podId }
    })
  }

  async runPod (podSpec: PodSpec): Promise<void> {
    // await this.createPod(podSpec).catch(async (err) => {
    try {
      await this.createPod(podSpec)
    } catch (e) {
      console.log(e)
      throw Boom.badImplementation('you failed')
    }
    //   console.log('caught an error at hyperclient')
    //   log.warn(`pulling images after error="${err.message}"`)
    //   await this.pullImages(podSpec)
    //   await this.createPod(podSpec).catch(async (err) => {
    //     console.log('second error hyperclient')
    //     console.log(err)
    //     console.log('waiting 5s for second hyper create')
    //     await new Promise(resolve => {
    //       setTimeout(() => {
    //         console.log('waited 5 seconds to fail second create')
    //         resolve()
    //       })
    //     })
    //     throw Boom.badImplementation('you failed')
    //   })
    //   console.log('hyperclient tried to create again')
    // })
    await this.startPod(podSpec.id)
    console.log('hyperclient ran pod.')
  }

  async deletePod (podId: string): Promise<void> {
    if (this.config.noop) return
    log.info('deleting pod. id=%s', podId)
    const res = await axios.request({
      socketPath: this.config.hyperSock,
      method: 'delete',
      url: '/pod',
      params: { podId }
    })
    if (res.data.Code !== 0) {
      throw Boom.serverUnavailable('Could not delete pod: hyper error code=' + res.data.Code)
    }
  }

  getLog (containerId: string, follow: boolean = false): Promise<IncomingMessage> {
    log.info('attaching to container. containerId=%s', containerId)
    return new Promise((resolve, reject) => {
      const query = querystring.stringify({
        container: containerId,
        stdout: true,
        stderr: true,
        follow
      })
      const req = get({
        socketPath: this.config.hyperSock,
        method: 'GET',
        path: '/container/logs?' + query
      }, (res) => {
        resolve(res)
      })

      req.on('error', (err) => {
        log.error(
          'failed to attach to container. containerId=%s error=%s',
          containerId,
          err.stack
        )

        reject(err)
      })
    })
  }
}
